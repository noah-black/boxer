"""
Analysis pipeline: drum assignment, custom text queries, and candidate building.
"""

import logging

import numpy as np

from backend.constants import (
    SAMPLE_RATE, BATCH_SIZE, DRUM_NAMES, N_CANDIDATES, EMBED_WINDOW,
)
from backend.models import embed_audio_batch, embed_texts, PROTOTYPES
from backend.dsp import clip_to_context_times

log = logging.getLogger(__name__)


def build_candidate_list(
    ranked_indices: list[int],
    times: list[float],
    clip_starts: list[int],
    clip_ends: list[int],
    audio: np.ndarray,
    scores_for_slot: np.ndarray | None = None,
) -> list[dict]:
    """Build the candidate payload for a single drum/custom slot.

    Args:
        ranked_indices: Clip indices ordered by preference (best first).
        times:          Start times (seconds) for all clips.
        clip_starts:    Start sample indices for all clips.
        clip_ends:      End sample indices for all clips.
        audio:          Full original audio array.
        scores_for_slot: Optional per-clip score array; if None, score defaults to 0.0.

    Returns:
        List of candidate dicts with time, score, and context window fields.
    """
    candidates_out = []
    seen: set[int] = set()
    for clip_index in ranked_indices:
        if clip_index in seen:
            continue
        seen.add(clip_index)
        ctx = clip_to_context_times(audio, clip_starts[clip_index], clip_ends[clip_index])
        score = round(float(scores_for_slot[clip_index]), 4) if scores_for_slot is not None else 0.0
        candidates_out.append({
            "time":  round(times[clip_index], 3),
            "score": score,
            **ctx,
        })
        if len(candidates_out) >= N_CANDIDATES:
            break
    return candidates_out


def run_drum_assignment(
    audio: np.ndarray,
    embed_clips: list[np.ndarray],
    times: list[float],
    clip_starts: list[int],
    clip_ends: list[int],
) -> tuple[np.ndarray, dict, int]:
    """Embed clips with CLAP, score against drum prototypes, and assign via two-pass
    nearest-neighbour.

    Returns:
        audio_embeds:  (n_embedded, embedding_dim) CLAP embeddings.
        drum_results:  {drum_name: {"candidates": [...]}} for each filled slot.
        n_embedded:    Number of clips that were actually embedded.
    """
    proto_matrices = {drum_name: np.stack(PROTOTYPES[drum_name]) for drum_name in DRUM_NAMES}
    n_clips      = len(embed_clips)
    embeds_list: list[np.ndarray] = []
    n_embedded   = 0

    log.info(f"Embedding {n_clips} clips ({EMBED_WINDOW*1000:.0f}ms windows)...")

    for batch_start in range(0, n_clips, BATCH_SIZE):
        batch        = embed_clips[batch_start : batch_start + BATCH_SIZE]
        batch_embeds = embed_audio_batch(batch)
        # Replace degenerate (NaN/inf) embeddings with zero vectors
        bad_mask = ~np.isfinite(batch_embeds).all(axis=1)
        if bad_mask.any():
            log.warning(f"  {bad_mask.sum()} degenerate embeddings in batch {batch_start}—replaced with zeros")
            batch_embeds[bad_mask] = 0.0
        embeds_list.append(batch_embeds)
        n_embedded += len(batch)

    audio_embeds = np.vstack(embeds_list)
    log.info(f"  Embedded {n_embedded}/{n_clips} clips")

    # Score all embedded clips against all drum prototypes
    scores = np.zeros((n_embedded, len(DRUM_NAMES)), dtype=np.float32)
    for drum_col, drum_name in enumerate(DRUM_NAMES):
        per_proto = audio_embeds @ proto_matrices[drum_name].T
        scores[:, drum_col] = per_proto.max(axis=1)

    # ── Two-pass assignment ────────────────────────────────────────────────────
    # Pass 1 (clip-first): each clip votes for its top drum type.
    # Pass 2 (fallback): any drum with zero votes gets the best unused clip.
    primary_votes = np.argmax(scores, axis=1)

    all_candidates: dict[str, list[tuple[float, int]]] = {
        drum_name: sorted(
            [(float(scores[i, drum_col]), i) for i in range(n_embedded)],
            key=lambda x: -x[0],
        )
        for drum_col, drum_name in enumerate(DRUM_NAMES)
    }

    vote_groups: dict[str, list[tuple[float, int]]] = {drum_name: [] for drum_name in DRUM_NAMES}
    for clip_index, drum_col in enumerate(primary_votes):
        drum_name = DRUM_NAMES[drum_col]
        vote_groups[drum_name].append((float(scores[clip_index, drum_col]), clip_index))

    winners: dict[str, tuple[float, int]] = {}
    used_indices: set[int] = set()

    # Pass 1: best clip from each drum's primary voters
    for drum_name in DRUM_NAMES:
        if vote_groups[drum_name]:
            best = max(vote_groups[drum_name], key=lambda x: x[0])
            winners[drum_name] = best
            used_indices.add(best[1])

    # Pass 2: fill empty slots from globally ranked candidates
    for drum_name in DRUM_NAMES:
        if drum_name not in winners:
            for score, clip_index in all_candidates[drum_name]:
                if clip_index not in used_indices:
                    winners[drum_name] = (score, clip_index)
                    used_indices.add(clip_index)
                    log.info(f"  {drum_name}: filled via fallback (score={score:.3f})")
                    break

    # Build candidate lists for each drum
    drum_results: dict = {}
    for drum_name in DRUM_NAMES:
        if drum_name not in winners:
            log.info(f"  {drum_name}: could not fill (not enough distinct clips)")
            continue

        _, winner_index = winners[drum_name]
        drum_col = DRUM_NAMES.index(drum_name)

        # Ranked indices: winner first, then top candidates
        ranked = [winner_index] + [
            clip_index for _, clip_index in all_candidates[drum_name]
            if clip_index != winner_index
        ]

        candidates_out = build_candidate_list(
            ranked, times, clip_starts, clip_ends, audio,
            scores_for_slot=scores[:, drum_col],
        )
        drum_results[drum_name] = {"candidates": candidates_out}
        log.info(
            f"  {drum_name}: winner @{times[winner_index]:.2f}s"
            f"  score={scores[winner_index, drum_col]:.3f}"
            f"  ({len(vote_groups[drum_name])} primary clips)"
        )

    return audio_embeds, drum_results, n_embedded


def run_custom_text_queries(
    audio_embeds: np.ndarray,
    clip_starts: list[int],
    clip_ends: list[int],
    times: list[float],
    audio: np.ndarray,
    custom_dict: dict[str, str],
) -> dict:
    """CLAP text-query each custom slot against the session embeddings.

    Returns {slot_id: {"candidates": [...]}} for slots with non-empty queries.
    """
    results: dict = {}
    for slot_id, query_text in custom_dict.items():
        if not query_text or not query_text.strip():
            continue
        try:
            text_embed = embed_texts([query_text.strip()])
            similarity_scores = (audio_embeds @ text_embed.T).squeeze()
            if similarity_scores.ndim == 0:
                similarity_scores = similarity_scores.reshape(1)
            ranked_indices = list(np.argsort(similarity_scores)[::-1][:N_CANDIDATES])
            candidates_out = build_candidate_list(
                ranked_indices, times, clip_starts, clip_ends, audio,
                scores_for_slot=similarity_scores,
            )
            results[slot_id] = {"candidates": candidates_out}
            log.info(f"  {slot_id} ('{query_text}'): top score={float(similarity_scores[ranked_indices[0]]):.3f}")
        except Exception as exc:
            log.warning(f"  {slot_id}: text embedding failed: {exc}")
    return results

# ── Acoustic vocabulary for CLAP nearest-neighbor label matching ──────────────
# Nouns only. Concrete, acoustically grounded.

PERCUSSION_INSTRUMENTS = [
    "kick drum", "bass drum", "snare drum", "snare", "rimshot", "cross-stick",
    "hi-hat", "open hi-hat", "closed hi-hat", "crash cymbal", "ride cymbal",
    "ride bell", "splash cymbal", "china cymbal",
    "floor tom", "rack tom", "high tom", "low tom",
    "conga", "bongo", "djembe", "cajon", "tabla", "darbuka", "riq",
    "tambourine", "shaker", "maracas", "cabasa", "guiro",
    "cowbell", "woodblock", "claves", "castanets",
    "triangle", "finger cymbal", "agogo bell",
    "frame drum", "bodhran", "talking drum",
    "marimba", "xylophone", "vibraphone", "glockenspiel",
    "tubular bell", "crotale", "singing bowl", "bell plate",
    "steel drum", "tongue drum", "handpan", "kalimba", "thumb piano",
]

ELECTRONIC_DRUM = [
    "808 kick", "808 bass", "909 snare", "909 hi-hat",
    "drum machine", "electronic snare", "electronic kick",
    "clap machine", "electronic hi-hat", "sampled drum",
    "beatbox kick", "beatbox snare", "beatbox hi-hat",
]

BODY_PERCUSSION = [
    "hand clap", "finger snap", "knuckle crack", "finger click",
    "chest thump", "body slap", "thigh slap", "palm slap",
    "foot stomp", "heel drop", "toe tap", "finger tap",
    "tongue click", "mouth pop", "lip pop", "cheek pop",
]

PITCHED_INSTRUMENTS = [
    "guitar pluck", "guitar strum", "acoustic guitar", "electric guitar",
    "bass guitar", "bass slap", "guitar harmonic",
    "piano key", "piano chord", "prepared piano",
    "harpsichord", "clavichord",
    "banjo", "ukulele", "mandolin", "sitar", "koto", "dulcimer",
    "harp", "pizzicato", "violin pizzicato",
    "music box note", "jaw harp", "harmonica",
    "rhodes", "wurlitzer", "clavinet", "organ",
    "synth stab", "synth pluck", "synth bass", "synth blip",
]

IMPACT_OBJECTS = [
    "knock", "tap", "thud", "thump", "smack", "whack", "slap",
    "punch", "hit", "strike", "impact",
    "door knock", "table knock", "floor knock",
    "hammer", "nail hit", "mallet",
    "book drop", "object drop", "box drop",
    "bat hit", "stick hit", "club hit",
]

HOLLOW_OBJECTS = [
    "bucket", "barrel",
    "pot", "pan", "bowl", "cup",
    "bottle", "glass", "jar",
    "tin can", "metal can", "oil drum",
    "cardboard box", "wooden box", "plastic bin",
    "pipe hit", "tube hit",
]

MECHANICAL = [
    "clock tick", "typewriter", "keyboard click", "mouse click",
    "switch click", "button press", "stapler",
    "door slam", "cabinet slam", "drawer slam",
    "lock click", "coin drop", "coin tap",
    "spring", "latch", "snap",
    "cash register", "lever",
]

MATERIALS = [
    "wood crack", "wood knock", "wood snap",
    "metal ring", "metal clang", "metal ping", "metal tap",
    "stone drop", "rock hit", "gravel",
    "glass tap", "glass break", "glass ring",
    "plastic snap", "rubber slap",
    "ceramic tap", "clay hit",
]

NATURAL = [
    "thunder crack", "thunder rumble",
    "water drop", "rain drop", "splash",
    "branch snap", "twig crack",
    "pebble drop", "sand pour",
    "bubble pop", "bubble burst",
]

ONOMATOPOEIA = [
    "boom", "bang", "crack", "snap", "pop", "click", "clack",
    "tick", "tock", "thud", "knock", "tap", "pat",
    "clop", "stomp", "clunk", "clang", "ding", "ping", "ring",
    "crash", "splash", "squish", "whoosh", "swish",
    "hiss", "crackle", "rattle", "jingle", "tinkle", "clink",
    "scrape", "squeak", "buzz", "blip", "zap",
    "plop", "drip", "patter", "chirp", "tweet",
    "thwack", "thwap", "whir",
]

ACOUSTIC_SPACES = [
    "cave echo", "tunnel echo", "stairwell echo",
    "bathroom reverb", "hall reverb", "room reverb",
    "outdoor", "underwater",
]

RECORDING_CHARACTER = [
    "vinyl recording", "tape recording", "cassette recording",
    "telephone", "radio", "lo-fi", "overdriven microphone",
]

FREQUENCY_NOUNS = [
    "bass", "sub-bass", "treble", "midrange",
    "rumble", "thump", "ring",
]

VOCABULARY: list[str] = (
    PERCUSSION_INSTRUMENTS + ELECTRONIC_DRUM + BODY_PERCUSSION
    + PITCHED_INSTRUMENTS + IMPACT_OBJECTS + HOLLOW_OBJECTS
    + MECHANICAL + MATERIALS + NATURAL + ONOMATOPOEIA
    + ACOUSTIC_SPACES + RECORDING_CHARACTER + FREQUENCY_NOUNS
)

seen: set[str] = set()
VOCABULARY = [w for w in VOCABULARY if not (w in seen or seen.add(w))]  # type: ignore

if __name__ == "__main__":
    print(f"{len(VOCABULARY)} terms")
    for name, lst in [
        ("Percussion", PERCUSSION_INSTRUMENTS), ("Electronic", ELECTRONIC_DRUM),
        ("Body", BODY_PERCUSSION), ("Pitched", PITCHED_INSTRUMENTS),
        ("Impact", IMPACT_OBJECTS), ("Hollow", HOLLOW_OBJECTS),
        ("Mechanical", MECHANICAL), ("Materials", MATERIALS),
        ("Natural", NATURAL), ("Onomatopoeia", ONOMATOPOEIA),
        ("Spaces", ACOUSTIC_SPACES), ("Recording", RECORDING_CHARACTER),
        ("Frequency", FREQUENCY_NOUNS),
    ]:
        print(f"  {name}: {len(lst)}")

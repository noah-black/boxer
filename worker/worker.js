const UPSTREAM = "noahblack--boxer-fastapi-app.modal.run";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = UPSTREAM;
    url.protocol = "https:";
    return fetch(new Request(url, request));
  },
};

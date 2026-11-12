// Content script (isolated world): chuyển tiếp yêu cầu từ trang tới service worker.
window.addEventListener("message", (ev) => {
  if (ev.source !== window || ev.data?.target !== "wallet-cardano-bg") return;
  const { id, method, params } = ev.data;
  chrome.runtime
    .sendMessage({ kind: "dapp", method, params })
    .then((r) => window.postMessage({ target: "wallet-cardano-page", id, ...r }, window.location.origin))
    .catch((e) => window.postMessage({ target: "wallet-cardano-page", id, ok: false, error: String(e) }, window.location.origin));
});

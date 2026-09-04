import client from "../api/client";

// The JWT lives in localStorage and is only attached by the axios
// interceptor — a plain browser navigation (window.open / <a target="_blank">)
// never carries it, so authenticated file routes (PDFs, Excel export,
// documents, bills, medical certs) 401 with "Missing auth token" if opened
// that way. Fetch the file through axios (auth header included) as a blob,
// then hand the browser a local blob: URL to view or download instead.
export async function openAuthedFile(url, { download, filename } = {}) {
  // `client`'s baseURL is already "/api" — but every URL we're handed here
  // (fileUrl/billLink/medicalCertLink from the API, and the ones written
  // inline in components) is written as a full "/api/..." path. Strip the
  // prefix so we don't end up requesting "/api/api/...".
  const path = url.startsWith("/api/") ? url.slice(4) : url;
  const res = await client.get(path, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(res.data);
  if (download) {
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    window.open(blobUrl, "_blank");
  }
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

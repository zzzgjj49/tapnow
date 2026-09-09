// Browser uploads directly to private TOS using short-lived, object-specific URLs.
window.uploadToCloud = async function (file, projectId, attachment, progress = () => {}) {
  async function api(url, body, method = 'POST') {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || '上传失败');
    return result;
  }
  const ticket = await api('/api/uploads/init', { projectId, file: { name: file.name, size: file.size } });
  try {
    for (let i = 0; i < ticket.urls.length; i++) {
      const body = file.slice(i * ticket.partSize, (i + 1) * ticket.partSize);
      let uploaded = false;
      for (let retry = 0; retry < 3 && !uploaded; retry++) {
        try {
          await new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('PUT', ticket.urls[i]); xhr.timeout = 180000;
            xhr.upload.onprogress = e => progress(Math.min(99, Math.round((i * ticket.partSize + e.loaded) / file.size * 100)));
            xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('分片上传失败'));
            xhr.onerror = xhr.ontimeout = () => reject(new Error('上传连接失败，请检查网络和存储桶跨域设置'));
            xhr.send(body);
          });
          uploaded = true;
        } catch (e) { if (retry === 2) throw e; }
      }
    }
    await api(`/api/uploads/${ticket.id}/complete`, {});
    const node = await api(`/api/uploads/${ticket.id}/attach`, attachment);
    progress(100); return node;
  } catch (e) { await api(`/api/uploads/${ticket.id}`, null, 'DELETE').catch(() => {}); throw e; }
};

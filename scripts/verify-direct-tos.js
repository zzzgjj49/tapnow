const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
process.loadEnvFile(path.join(root, '.env'));
async function main() {
  const bytes = fs.readFileSync(path.join(root, '.run/byteplus-live.mp4'));
  const records = {};
  const media = require('../cloud-media')({ records: () => records, uploadDir: path.join(root, 'data/uploads') });
  const ticket = await media.initiate('deployment-verification', { name:'direct-upload-check.mp4', size:bytes.length });
  try {
    for (let i=0;i<ticket.urls.length;i++) {
      const response = await fetch(ticket.urls[i], { method:'PUT', body:bytes.subarray(i*ticket.partSize,(i+1)*ticket.partSize), signal:AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error('Signed upload failed: ' + response.status);
    }
    records[ticket.url] = await media.complete(ticket);
    const downloaded = await fetch(media.signedUrl(ticket.url), { signal:AbortSignal.timeout(30000) });
    if (!downloaded.ok) throw new Error('Download failed');
    const actual = Buffer.from(await downloaded.arrayBuffer());
    if (!actual.equals(bytes)) throw new Error('Checksum mismatch');
    const result = { key:ticket.key, bytes:bytes.length, checksum:crypto.createHash('sha256').update(bytes).digest('hex'), signedUpload:'passed' };
    fs.writeFileSync(path.join(root,'.run/direct-tos-verification.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
  } catch(e) { await media.abort(ticket).catch(()=>{}); throw e; }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.code || (String(e.message).includes('http') ? 'TOS verification failed' : e.message));process.exit(1);});

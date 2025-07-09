// api/upload.js

// Garante que o @vercel/blob encontre o token de escrita
if (!process.env.BLOB_STORE_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN) {
  process.env.BLOB_STORE_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
}

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  // Extrai e valida query params
  const { filename, equipe } = req.query;
  console.log('UPLOAD /api/upload query:', req.query);
  if (!filename || !equipe) {
    return res
      .status(400)
      .json({ error: 'Parâmetros “filename” e “equipe” são obrigatórios' });
  }

  // Monta a key no bucket
  const timestamp = Date.now();
  const key = `coletas/${equipe}/${timestamp}_${filename}`;
  console.log('UPLOAD put key =', key);

  // Lê o corpo inteiro como Buffer, para depois passar ao blob
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const fileBuffer = Buffer.concat(chunks);
  console.log('UPLOAD: corpo recebido, tamanho =', fileBuffer.length);

  try {
    // Envia ao Vercel Blob, incluindo o header x-content-length
    const blob = await put(key, fileBuffer, {
      access: 'public',
      addRandomSuffix: false,
      headers: {
        'x-content-length': fileBuffer.length
      }
    });
    console.log('UPLOAD put result =', blob);

    // O SDK retorna { url, key }
    if (!blob.url || !blob.key) {
      console.error('UPLOAD: resposta inesperada', blob);
      return res
        .status(500)
        .json({ error: 'Upload não retornou url ou key' });
    }

    // Responde com a URL pública e a key (pathname)
    return res.status(200).json({
      url:      blob.url,
      pathname: blob.key
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    return res.status(500).json({ error: err.message });
  }
};

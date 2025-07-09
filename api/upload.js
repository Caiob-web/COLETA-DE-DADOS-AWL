// api/upload.js

// fallback do token nativo para o que o SDK espera
if (!process.env.BLOB_STORE_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN) {
  process.env.BLOB_STORE_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
}

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  // extrai e valida query params
  const { filename, equipe } = req.query;
  console.log('UPLOAD /api/upload query:', req.query);
  if (!filename || !equipe) {
    return res
      .status(400)
      .json({ error: 'Parâmetros “filename” e “equipe” são obrigatórios' });
  }

  // monta a key no bucket
  const timestamp = Date.now();
  const key = `coletas/${equipe}/${timestamp}_${filename}`;
  console.log('UPLOAD put key =', key);

  try {
    // grava no Blob
    const blob = await put(key, req.body, {
      access: 'public',
      addRandomSuffix: false
    });
    console.log('UPLOAD put result =', blob);

    // aqui o SDK retorna { url, key }
    const blobKey = blob.key;
    if (!blob.url || !blobKey) {
      console.error('UPLOAD: blob retornou sem url ou key', blob);
      return res
        .status(500)
        .json({ error: 'Upload não retornou url ou key' });
    }

    // responde com a URL pública e a key (usada depois para baixar o blob)
    return res.status(200).json({
      url:      blob.url,
      pathname: blobKey
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    return res.status(500).json({ error: err.message });
  }
};

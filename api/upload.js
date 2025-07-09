// api/upload.js

// Faz fallback do token nativo BLOB_READ_WRITE_TOKEN para BLOB_STORE_WRITE_TOKEN
if (!process.env.BLOB_STORE_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN) {
  process.env.BLOB_STORE_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
}

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  // filename e equipe são obrigatórios na query
  const { filename, equipe } = req.query;
  if (!filename || !equipe) {
    return res
      .status(400)
      .json({ error: 'Parâmetros “filename” e “equipe” são obrigatórios' });
  }

  try {
    // Gera uma key única no bucket
    const timestamp = Date.now();
    const key = `coletas/${equipe}/${timestamp}_${filename}`;

    // Envia diretamente o corpo ao Vercel Blob
    const blob = await put(key, req.body, {
      access: 'public',
      addRandomSuffix: false
    });

    // Retorna a URL pública e o pathname (key)
    return res.status(200).json({
      url:      blob.url,
      pathname: blob.pathname
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    return res.status(500).json({ error: err.message });
  }
};

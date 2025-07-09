// api/upload.js

// Garantia de que o token será lido pelo SDK
if (!process.env.BLOB_STORE_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN) {
  process.env.BLOB_STORE_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
}

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  const { filename, equipe } = req.query;
  console.log('UPLOAD /api/upload query:', req.query);

  if (!filename || !equipe) {
    return res
      .status(400)
      .json({ error: 'Parâmetros “filename” e “equipe” são obrigatórios' });
  }

  const key = `coletas/${equipe}/${Date.now()}_${filename}`;
  console.log('UPLOAD put key =', key);

  try {
    // Aqui passamos o próprio `req` — o SDK pega a stream e os headers corretamente
    const blob = await put(key, req, {
      access: 'public',
      addRandomSuffix: false
    });

    console.log('UPLOAD put result =', blob);

    if (!blob.url || !blob.key) {
      console.error('UPLOAD: resposta inesperada', blob);
      return res
        .status(500)
        .json({ error: 'Upload não retornou url ou key' });
    }

    return res.status(200).json({
      url:      blob.url,
      pathname: blob.key
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    return res.status(500).json({ error: err.message });
  }
};

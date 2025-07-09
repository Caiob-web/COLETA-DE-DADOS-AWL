// api/upload.js

// garante que o @vercel/blob encontre o token de escrita
if (!process.env.BLOB_STORE_WRITE_TOKEN && process.env.BLOB_READ_WRITE_TOKEN) {
  process.env.BLOB_STORE_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
}

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // Só POST
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

  // Gera a key e dispara o put()
  const timestamp = Date.now();
  const key = `coletas/${equipe}/${timestamp}_${filename}`;
  console.log('UPLOAD put key =', key);

  try {
    const blob = await put(key, req.body, {
      access: 'public',
      addRandomSuffix: false
    });
    console.log('UPLOAD put result =', blob);

    // Garante que URL e pathname sempre existam
    if (!blob.url || !blob.pathname) {
      console.error('UPLOAD: blob retornou sem url/pathname', blob);
      return res
        .status(500)
        .json({ error: 'Upload não retornou url ou pathname' });
    }

    // Responde corretamente
    return res.status(200).json({
      url:      blob.url,
      pathname: blob.pathname
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    return res.status(500).json({ error: err.message });
  }
};

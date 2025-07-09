// api/upload.js

const { put } = require('@vercel/blob');

module.exports = async function handler(req, res) {
  // Só aceita POST
  if (req.method !== 'POST') {
    res.status(405).end('Método não permitido');
    return;
  }

  try {
    const { filename, equipe } = req.query;
    if (!filename || !equipe) {
      return res
        .status(400)
        .json({ error: 'Parâmetros “filename” e “equipe” são obrigatórios' });
    }

    // Gera uma key única dentro do bucket
    const timestamp = Date.now();
    const key = `coletas/${equipe}/${timestamp}_${filename}`;

    // Faz o upload direto ao Vercel Blob
    const blob = await put(key, req.body, {
      access: 'public',
      addRandomSuffix: false
    });

    // Retorna a URL pública e o pathname (key)
    res.status(200).json({
      url:      blob.url,      // ex: https://<bucket>.public.blob.vercel-storage.com/{key}
      pathname: blob.pathname  // o próprio key
    });
  } catch (err) {
    console.error('Erro em /api/upload:', err);
    res.status(500).json({ error: err.message });
  }
};

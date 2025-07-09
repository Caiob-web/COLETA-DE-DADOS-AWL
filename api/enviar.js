// api/enviar.js

const { google } = require('googleapis');
const { get }   = require('@vercel/blob');
const { URL }   = require('url');

module.exports = async function handler(req, res) {
  // Log do corpo recebido
  console.log('BODY /api/enviar', JSON.stringify(req.body));

  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  try {
    // 1) Autenticação JWT
    const authClient = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key:   process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    await authClient.authorize();

    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive({ version: 'v3', auth: authClient });

    // 2) Extrai dados + URLs de fotos
    const { latitude, longitude, rua, bairro, cidade, fotos = [] } = req.body;
    const linksFotos = [];

    // 3) Re-upload de até 5 fotos
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const fotoUrl = fotos[i];
      if (!fotoUrl || typeof fotoUrl !== 'string') {
        console.warn(`Skipping invalid foto[${i}]:`, fotoUrl);
        continue;
      }

      // converte URL em pathname
      const parsed = new URL(fotoUrl);
      const pathname = decodeURIComponent(parsed.pathname.slice(1));

      // busca o blob como stream
      const { body: stream } = await get(pathname);

      // envia ao Drive
      const filename = pathname.split('/').pop();
      const { data: upload } = await drive.files.create({
        resource: { name: filename, parents: [process.env.DRIVE_FOLDER_ID] },
        media:    { mimeType: 'application/octet-stream', body: stream },
        fields:   'id'
      });

      // permissão pública
      await drive.permissions.create({
        fileId: upload.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      linksFotos.push(
        `https://drive.google.com/file/d/${upload.id}/view?usp=sharing`
      );
    }

    // 4) Monta a linha e grava no Sheets
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const row = [
      timestamp,
      `${latitude},${longitude}`,
      rua,
      bairro,
      cidade,
      ...linksFotos
    ];
    while (row.length < 13) row.push('');

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] }
    });

    // 5) Retorna sucesso
    return res.status(200).json({ success: true, links: linksFotos });

  } catch (err) {
    console.error('Erro em /api/enviar:', err);
    return res.status(500).json({ error: err.message });
  }
};

// api/enviar.js

const { google } = require('googleapis');
const { URL }   = require('url');
const fetch     = global.fetch;            // Node 18+ has a global fetch
const { Readable } = require('stream');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  try {
    // 1) Autentica na Google API
    const authClient = new google.auth.JWT({
      email: process.env.GOOGLE_CLIENT_EMAIL,
      key:   process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    await authClient.authorize();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive ({ version: 'v3', auth: authClient });

    // 2) Extrai o body
    const { latitude, longitude, rua, bairro, cidade, fotos = [] } = req.body;
    console.log('Fotos recebidas:', fotos);
    const linksFotos = [];

    // 3) Para cada URL de foto, baixa e envia ao Drive
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const fotoUrl = fotos[i];
      if (!fotoUrl || typeof fotoUrl !== 'string') {
        console.warn(`Pulando foto inválida [${i}]:`, fotoUrl);
        continue;
      }

      console.log(`Buscando blob em ${fotoUrl}`);
      const resp = await fetch(fotoUrl);
      if (!resp.ok) {
        console.warn(`Falha ao baixar blob [${i}]:`, resp.status);
        continue;
      }

      const contentType = resp.headers.get('content-type') || 'application/octet-stream';
      const arrayBuf    = await resp.arrayBuffer();
      const buffer      = Buffer.from(arrayBuf);
      const stream      = Readable.from(buffer);

      // extrai filename da URL
      const pathname = new URL(fotoUrl).pathname.split('/').pop();
      const filename = decodeURIComponent(pathname);

      console.log(`Enviando ao Drive: ${filename}`);
      const { data: upload } = await drive.files.create({
        resource: { name: filename, parents: [process.env.DRIVE_FOLDER_ID] },
        media:    { mimeType: contentType, body: stream },
        fields:   'id'
      });

      await drive.permissions.create({
        fileId: upload.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      const driveUrl = `https://drive.google.com/file/d/${upload.id}/view?usp=sharing`;
      console.log(`Arquivo enviado ao Drive: ${driveUrl}`);
      linksFotos.push(driveUrl);
    }

    // 4) Grava no Sheets
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

    console.log('Gravando linha no Sheets:', row);
    await sheets.spreadsheets.values.append({
      spreadsheetId:    process.env.SHEET_ID,
      range:            'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: [row] }
    });

    console.log('Sucesso em /api/enviar');
    return res.status(200).json({ success: true, links: linksFotos });

  } catch (err) {
    console.error('Erro em /api/enviar:', err);
    return res.status(500).json({ error: err.message });
  }
};

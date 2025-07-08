// api/enviar.js
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Only POST');
  }

  try {
    // 1) Reconstrói credenciais a partir de ENV (definidas no Vercel)
    const credentials = {
      type: process.env.GOOGLE_TYPE,
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: process.env.GOOGLE_AUTH_URI,
      token_uri: process.env.GOOGLE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.GOOGLE_CLIENT_CERT_URL,
      universe_domain: process.env.GOOGLE_UNIVERSE_DOMAIN,
    };

    // 2) JWT client
    const authClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file',
      ],
    });
    await authClient.authorize();

    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive({ version: 'v3', auth: authClient });

    // 3) Garante uploads dir
    const uploadsDir = path.join(process.cwd(), 'uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

    // 4) Desconstrói body
    const { latitude, longitude, rua, bairro, cidade, fotos } = req.body;
    const linksFotos = [];

    // 5) Faz upload das fotos
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const base64 = fotos[i];
      if (!base64.includes(',')) continue;

      const data = base64.split(',')[1];
      const buffer = Buffer.from(data, 'base64');
      const filename = `foto_${Date.now()}_${i + 1}.jpg`;
      const tmp = path.join(uploadsDir, filename);
      fs.writeFileSync(tmp, buffer);

      const { data: upload } = await drive.files.create({
        resource: { name: filename, parents: [process.env.DRIVE_FOLDER_ID] },
        media: { mimeType: 'image/jpeg', body: fs.createReadStream(tmp) },
        fields: 'id',
      });
      await drive.permissions.create({
        fileId: upload.id,
        requestBody: { role: 'reader', type: 'anyone' },
      });
      linksFotos.push(`https://drive.google.com/file/d/${upload.id}/view?usp=sharing`);
      fs.unlinkSync(tmp);
    }

    // 6) Monta linha e insere no Sheets
    const timestamp = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const row = [
      timestamp,
      `${latitude},${longitude}`,
      rua, bairro, cidade,
      ...linksFotos
    ];
    while (row.length < 13) row.push('');

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range: 'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] },
    });

    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro no /api/enviar:', err);
    res.status(500).send({ error: err.message });
  }
}

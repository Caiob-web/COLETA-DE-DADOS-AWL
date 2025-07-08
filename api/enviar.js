// api/enviar.js
import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';
import os from 'os';

export const config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
};

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  // carrega credenciais de ENV
  const credentials = {
    type:                   process.env.GOOGLE_TYPE,
    project_id:             process.env.GOOGLE_PROJECT_ID,
    private_key_id:         process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key:            process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    client_email:           process.env.GOOGLE_CLIENT_EMAIL,
    client_id:              process.env.GOOGLE_CLIENT_ID,
    auth_uri:               process.env.GOOGLE_AUTH_URI,
    token_uri:              process.env.GOOGLE_TOKEN_URI,
    auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
    client_x509_cert_url:        process.env.GOOGLE_CLIENT_CERT_URL,
    universe_domain:        process.env.GOOGLE_UNIVERSE_DOMAIN,
  };

  const SHEET_ID         = process.env.SHEET_ID;
  const DRIVE_FOLDER_ID  = process.env.DRIVE_FOLDER_ID;

  try {
    const authClient = new google.auth.JWT({
      email:  credentials.client_email,
      key:    credentials.private_key,
      scopes: SCOPES
    });

    await authClient.authorize();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive({ version: 'v3', auth: authClient });

    const { latitude, longitude, rua, bairro, cidade, fotos } = req.body;
    const links = [];

    // crio uma pasta temporária para upload local
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upl-'));

    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const b64 = fotos[i];
      if (!b64.includes(',')) continue;

      const data = b64.split(',')[1];
      const buffer = Buffer.from(data, 'base64');
      const filename = `foto_${Date.now()}_${i+1}.jpg`;
      const filePath = path.join(tmpDir, filename);
      fs.writeFileSync(filePath, buffer);

      const { data: upload } = await drive.files.create({
        resource: { name: filename, parents: [DRIVE_FOLDER_ID] },
        media: { mimeType: 'image/jpeg', body: fs.createReadStream(filePath) },
        fields: 'id'
      });

      await drive.permissions.create({
        fileId: upload.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      links.push(`https://drive.google.com/file/d/${upload.id}/view?usp=sharing`);
      fs.unlinkSync(filePath);
    }

    const timestamp = new Date().toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'});
    const row = [ timestamp, `${latitude},${longitude}`, rua, bairro, cidade, ...links ];
    while (row.length < 13) row.push('');

    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [row] }
    });

    res.status(200).send('OK');
  } catch (err) {
    console.error('Erro na API /enviar:', err);
    res.status(500).json({ error: err.message });
  }
}

// server.js

// 1) Carrega dotenv se estiver instalado (uso local)
try {
  require('dotenv').config();
} catch {
  console.warn('dotenv não encontrado; usando ENV do ambiente');
}

const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 2) Garante que a pasta de uploads exista
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// 3) Escopos necessários para Sheets e Drive
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

// 4) Monta o objeto de credenciais a partir de ENV vars
const credentials = {
  type:                        process.env.GOOGLE_TYPE,
  project_id:                  process.env.GOOGLE_PROJECT_ID,
  private_key_id:              process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key:                 process.env.GOOGLE_PRIVATE_KEY.replace(/\n/g, '\n'),
  client_email:                process.env.GOOGLE_CLIENT_EMAIL,
  client_id:                   process.env.GOOGLE_CLIENT_ID,
  auth_uri:                    process.env.GOOGLE_AUTH_URI,
  token_uri:                   process.env.GOOGLE_TOKEN_URI,
  auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
  client_x509_cert_url:        process.env.GOOGLE_CLIENT_CERT_URL,
  universe_domain:             process.env.GOOGLE_UNIVERSE_DOMAIN
};

// 5) IDs da sua planilha e da pasta do Drive também por ENV
const SHEET_ID        = process.env.SHEET_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// 6) Instancia o client JWT para autenticar
const authClient = new google.auth.JWT({
  email:  credentials.client_email,
  key:    credentials.private_key,
  scopes: SCOPES
});

// 7) Rota de recebimento dos dados
//    Note: usamos `/api/send` para alinhar com a convenção Vercel
app.post('/api/send', async (req, res) => {
  try {
    // 7.1) Autoriza com as credenciais
    await authClient.authorize();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive ({ version: 'v3', auth: authClient });

    // 7.2) Extrai do corpo da requisição
    const { latitude, longitude, rua, bairro, cidade, fotos = [] } = req.body;
    const linksFotos = [];

    // 7.3) Faz upload de até 5 fotos no Drive
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const base64 = fotos[i];
      if (!base64.includes(',')) continue;
      try {
        const data     = base64.split(',')[1];
        const buffer   = Buffer.from(data, 'base64');
        const filename = `foto_${Date.now()}_${i+1}.jpg`;
        const tmpPath  = path.join(uploadsDir, filename);
        fs.writeFileSync(tmpPath, buffer);

        // envia ao Drive
        const { data: upload } = await drive.files.create({
          resource: { name: filename, parents: [DRIVE_FOLDER_ID] },
          media:    { mimeType: 'image/jpeg', body: fs.createReadStream(tmpPath) },
          fields:   'id'
        });
        const fileId = upload.id;
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' }
        });
        linksFotos.push(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`);
        fs.unlinkSync(tmpPath);
      } catch (imgErr) {
        console.warn(`Erro processando imagem ${i+1}:`, imgErr.message);
      }
    }

    // 7.4) Prepara a linha para o Sheets
    const timestamp = new Date()
      .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const row = [
      timestamp,
      `${latitude},${longitude}`,
      rua,
      bairro,
      cidade,
      ...linksFotos
    ];
    while (row.length < 13) row.push('');

    // 7.5) Grava no Google Sheets na aba “COLETA DE DADOS AWL” a partir da célula A1
    await sheets.spreadsheets.values.append({
      spreadsheetId:    SHEET_ID,
      range:            'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: [row] }
    });

    // 7.6) Retorna sucesso
    return res.status(200).json({ success: true, links: linksFotos });
  } catch (err) {
    console.error('Erro geral:', err);
    return res.status(500).json({ error: err.message });
  }
});

// 8) Sobe o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Servidor rodando em http://localhost:${PORT}`)
);

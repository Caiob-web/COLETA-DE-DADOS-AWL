// server.js

// 1) Carrega dotenv se estiver instalado, senão assume que as ENV já estão definidas
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

// 3) Escopos do Google APIs
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

// 4) Reconstrói as credenciais a partir de variáveis de ambiente individuais
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

// 4.1) DEBUG: veja como começa sua chave privada
console.log('>>> Preview da private_key (início):', credentials.private_key.slice(0, 30));

// 5) IDs de planilha e pasta no Drive
const SHEET_ID = process.env.SHEET_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;

// 6) Instancia o client JWT com as credenciais
const authClient = new google.auth.JWT({
  email: credentials.client_email,
  key: credentials.private_key,
  scopes: SCOPES,
});

// 7) Rota principal: recebe dados, faz upload das fotos e insere no Sheets
app.post('/enviar', async (req, res) => {
  try {
    // autentica
    await authClient.authorize();
    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive({ version: 'v3', auth: authClient });

    const { latitude, longitude, rua, bairro, cidade, fotos } = req.body;
    const linksFotos = [];

    // faz upload de até 5 fotos
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const base64 = fotos[i];
      if (!base64 || !base64.includes(',')) continue;
      try {
        const data = base64.split(',')[1];
        const buffer = Buffer.from(data, 'base64');
        const filename = `foto_${Date.now()}_${i+1}.jpg`;
        const tempPath = path.join(uploadsDir, filename);
        fs.writeFileSync(tempPath, buffer);

        const fileMeta = { name: filename, parents: [DRIVE_FOLDER_ID] };
        const media = { mimeType: 'image/jpeg', body: fs.createReadStream(tempPath) };

        const uploadRes = await drive.files.create({
          resource: fileMeta,
          media,
          fields: 'id',
        });
        const fileId = uploadRes.data.id;

        // libera acesso público
        await drive.permissions.create({
          fileId,
          requestBody: { role: 'reader', type: 'anyone' },
        });

        linksFotos.push(`https://drive.google.com/file/d/${fileId}/view?usp=sharing`);
        fs.unlinkSync(tempPath);
      } catch (e) {
        console.warn(`Erro ao processar imagem ${i+1}:`, e.message);
      }
    }

    // monta a linha pra inserir no Sheets
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

    // insere no Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: 'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [ row ] },
    });

    res.send('OK');
  } catch (err) {
    console.error('Erro geral:', err);
    res.status(500).send('Erro: ' + err.message);
  }
});

// 8) Inicia o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));

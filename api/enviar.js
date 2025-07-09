// api/enviar.js

const { google } = require('googleapis');
const { get }   = require('@vercel/blob');
const { URL }   = require('url');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end('Método não permitido');
  }

  try {
    // 1) Reconstrói as credenciais da conta de serviço a partir das ENVs
    const credentials = {
      type:                        process.env.GOOGLE_TYPE,
      project_id:                  process.env.GOOGLE_PROJECT_ID,
      private_key_id:              process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key:                 process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email:                process.env.GOOGLE_CLIENT_EMAIL,
      client_id:                   process.env.GOOGLE_CLIENT_ID,
      auth_uri:                    process.env.GOOGLE_AUTH_URI,
      token_uri:                   process.env.GOOGLE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.GOOGLE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url:        process.env.GOOGLE_CLIENT_CERT_URL,
      universe_domain:             process.env.GOOGLE_UNIVERSE_DOMAIN
    };

    // 2) Cria o client JWT e autentica
    const authClient = new google.auth.JWT({
      email:  credentials.client_email,
      key:    credentials.private_key,
      scopes: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.file'
      ]
    });
    await authClient.authorize();

    const sheets = google.sheets({ version: 'v4', auth: authClient });
    const drive  = google.drive ({ version: 'v3', auth: authClient });

    // 3) Extrai dados do corpo da requisição
    const { latitude, longitude, rua, bairro, cidade, fotos = [] } = req.body;
    const linksFotos = [];

    // 4) Para cada foto (URL pública do Blob ou pathname), faz fetch do Blob e envia ao Drive
    for (let i = 0; i < Math.min(fotos.length, 5); i++) {
      const foto = fotos[i];
      // determina o pathname interno do Blob
      let pathname;
      if (foto.startsWith('http')) {
        const parsed = new URL(foto);
        pathname = decodeURIComponent(parsed.pathname.slice(1)); // remove barra inicial
      } else {
        pathname = foto;
      }

      // obtém o stream do Blob
      const { body: stream } = await get(pathname);

      // envia ao Drive
      const filename = pathname.split('/').pop();
      const { data: upload } = await drive.files.create({
        resource: { name: filename, parents: [process.env.DRIVE_FOLDER_ID] },
        media:    { mimeType: 'application/octet-stream', body: stream },
        fields:   'id'
      });

      // define permissão de leitura pública
      await drive.permissions.create({
        fileId: upload.id,
        requestBody: { role: 'reader', type: 'anyone' }
      });

      linksFotos.push(`https://drive.google.com/file/d/${upload.id}/view?usp=sharing`);
    }

    // 5) Monta a linha para o Google Sheets
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

    // 6) Insere no Sheets
    await sheets.spreadsheets.values.append({
      spreadsheetId:    process.env.SHEET_ID,
      range:            'COLETA DE DADOS AWL!A1',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody:      { values: [row] }
    });

    // 7) Retorna sucesso
    return res.status(200).json({ success: true, links: linksFotos });
  } catch (err) {
    console.error('Erro na função /api/enviar:', err);
    return res.status(500).json({ error: err.message });
  }
};

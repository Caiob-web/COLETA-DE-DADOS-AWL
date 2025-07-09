// public/main.js

const apiKey         = "pk.481f46d0a98c9a0b3fb99b5d1cbd9658";
const uploadEndpoint = "/api/upload";
const enviarEndpoint = "/api/enviar";
const dbName         = "coletas_offline";
const equipeId       = "default";
let db;

// --- IndexedDB helpers ---
async function ensureDB() {
  if (db) return;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = e => {
      const inst = e.target.result;
      if (!inst.objectStoreNames.contains("coletas")) {
        inst.createObjectStore("coletas", { autoIncrement: true });
      }
    };
    req.onsuccess = e => {
      db = e.target.result;
      resolve();
    };
  });
}

async function salvarOffline(payload) {
  await ensureDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("coletas", "readwrite");
    const reqAdd = tx.objectStore("coletas").add(payload);
    reqAdd.onsuccess = () => res();
    reqAdd.onerror   = () => rej(reqAdd.error);
  });
  atualizarStatusPendentes();
  alert("Sem conexão, coleta salva offline. Sincronize depois.");
}

async function atualizarStatusPendentes() {
  if (!db) return;
  const tx = db.transaction("coletas", "readonly");
  const countReq = tx.objectStore("coletas").count();
  countReq.onsuccess = () => {
    const n = countReq.result;
    document.getElementById("statusPendentes").textContent =
      n > 0
        ? `${n} coleta(s) offline pendente(s)`
        : "Nenhuma coleta offline pendente";
  };
}

// --- UI helpers ---
function exibirLoading(on) {
  document.getElementById("loading").style.display = on ? "flex" : "none";
}
function exibirSucesso(on) {
  document.getElementById("sucesso").style.display = on ? "flex" : "none";
}
function exibirSincronizacao(on) {
  document.getElementById("sincronizacao").style.display = on ? "flex" : "none";
}

// --- Geolocalização e reverse ---
function configurarGeolocalizacao() {
  document.getElementById("btnCoordenadas").addEventListener("click", () => {
    exibirLoading(true);
    if (!navigator.geolocation) {
      alert("Geolocalização não suportada.");
      return exibirLoading(false);
    }
    navigator.geolocation.getCurrentPosition(
      async pos => {
        const { latitude: lat, longitude: lon } = pos.coords;
        document.getElementById("coordenadas").value = `${lat}, ${lon}`;
        try {
          const res = await fetch(
            `https://us1.locationiq.com/v1/reverse?key=${apiKey}&lat=${lat}&lon=${lon}&format=json`
          );
          const data = await res.json();
          document.getElementById("rua").value =
            data.address.road || "";
          document.getElementById("bairro").value =
            data.address.suburb ||
            data.address.neighbourhood ||
            "";
          document.getElementById("cidade").value =
            data.address.city ||
            data.address.town ||
            data.address.village ||
            "";
        } catch {
          alert("Erro ao buscar endereço.");
        } finally {
          exibirLoading(false);
        }
      },
      () => {
        alert("Permissão negada para geolocalização.");
        exibirLoading(false);
      }
    );
  });
}

// --- Formulário principal com logs ---
function configurarFormulario() {
  const form = document.getElementById("formulario");
  form.addEventListener("submit", async e => {
    e.preventDefault();
    exibirLoading(true);

    // Monta payload base
    const [lat, lon] = (
      document.getElementById("coordenadas").value || ","
    ).split(",");
    const payloadBase = {
      latitude:  lat.trim(),
      longitude: lon.trim(),
      rua:       document.getElementById("rua").value,
      bairro:    document.getElementById("bairro").value,
      cidade:    document.getElementById("cidade").value,
      fotos:     []
    };

    // Se offline, salva e retorna
    if (!navigator.onLine) {
      await salvarOffline(payloadBase);
      exibirLoading(false);
      return;
    }

    try {
      const files = document.getElementById("fotos").files;
      console.log("Iniciando upload de", files.length, "arquivo(s)");

      // 1) Upload ao Blob
      for (let i = 0; i < Math.min(files.length, 5); i++) {
        const file = files[i];
        console.log(`Upload [${i}] do arquivo:`, file.name);

        const resUp = await fetch(
          `${uploadEndpoint}?filename=${encodeURIComponent(file.name)}&equipe=${encodeURIComponent(equipeId)}`,
          { method: "POST", body: file }
        );

        const text = await resUp.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch {
          console.error("Resposta inválida do upload:", text);
          throw new Error("Upload retornou JSON inválido");
        }

        console.log("Resultado do upload:", result);
        if (!resUp.ok || typeof result.url !== "string") {
          throw new Error(
            `Upload falhou ou URL ausente: ${resUp.status} ${result.error||text}`
          );
        }

        payloadBase.fotos.push(result.url);
      }

      console.log("URLs obtidas após upload:", payloadBase.fotos);

      // 2) Log do payload completo
      console.log("Enviando payload para /api/enviar:", payloadBase);

      // 3) Envia para o Sheets/Drive
      const resp = await fetch(enviarEndpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payloadBase)
      });

      const ct = resp.headers.get("Content-Type") || "";
      if (!resp.ok) {
        let errMsg;
        if (ct.includes("application/json")) {
          errMsg = (await resp.json()).error;
        } else {
          errMsg = await resp.text();
        }
        throw new Error(errMsg || resp.statusText);
      }

      console.log("/api/enviar retornou 200");
      form.reset();
      exibirSucesso(true);

    } catch (err) {
      console.error("Erro no fluxo de envio:", err);
      if (navigator.onLine) {
        alert("Erro ao enviar coleta: " + err.message);
      } else {
        await salvarOffline(payloadBase);
      }
    } finally {
      exibirLoading(false);
    }
  });

  document.getElementById("btnNovaColeta")
    .addEventListener("click", () => exibirSucesso(false));
}

// --- Sincronização manual ---
function configurarSincronizacao() {
  document.getElementById("btnSincronizar").addEventListener("click", async () => {
    await ensureDB();
    exibirLoading(true);

    const store = db.transaction("coletas", "readonly").objectStore("coletas");
    const allDados = await new Promise(r =>
      (store.getAll().onsuccess = e => r(e.target.result))
    );
    const allKeys = await new Promise(r =>
      (store.getAllKeys().onsuccess = e => r(e.target.result))
    );

    let enviado = 0;
    for (let i = 0; i < allDados.length; i++) {
      try {
        const r = await fetch(enviarEndpoint, {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify(allDados[i])
        });
        if (r.ok) {
          await new Promise(del => {
            const tx = db.transaction("coletas", "readwrite");
            tx.objectStore("coletas")
              .delete(allKeys[i])
              .onsuccess = del;
          });
          enviado++;
        }
      } catch {
        break;
      }
    }

    exibirLoading(false);
    atualizarStatusPendentes();
    if (enviado === allDados.length && enviado > 0) {
      exibirSincronizacao(true);
      setTimeout(() => {
        document.getElementById("barraProgressoWrapper").style.display = "none";
      }, 1500);
    }
  });

  document.getElementById("btnFecharSincronizacao")
    .addEventListener("click", () => exibirSincronizacao(false));
}

// --- Init ---
window.addEventListener("DOMContentLoaded", () => {
  exibirLoading(false);
  configurarGeolocalizacao();
  configurarFormulario();
  configurarSincronizacao();
  atualizarStatusPendentes();
});

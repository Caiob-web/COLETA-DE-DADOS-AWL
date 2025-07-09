// public/main.js

const apiKey = "pk.481f46d0a98c9a0b3fb99b5d1cbd9658";
const uploadEndpoint = "/api/upload";
const enviarEndpoint = "/api/enviar";
const dbName = "coletas_offline";
let db;

// Se você quiser diferenciar por equipe, ajuste aqui:
const equipeId = "default";

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

async function atualizarStatusPendentes() {
  if (!db) return;
  const tx = db.transaction("coletas", "readonly");
  const store = tx.objectStore("coletas");
  const countReq = store.count();
  countReq.onsuccess = () => {
    const n = countReq.result;
    document.getElementById("statusPendentes").textContent =
      n > 0
        ? `${n} coleta(s) offline pendente(s)`
        : "Nenhuma coleta offline salva";
  };
}

function exibirLoading(on) {
  document.getElementById("loading").style.display = on ? "flex" : "none";
}
function exibirSucesso(on) {
  document.getElementById("sucesso").style.display = on ? "flex" : "none";
}
function exibirSincronizacao(on) {
  document.getElementById("sincronizacao").style.display = on ? "flex" : "none";
}

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
          document.getElementById("rua").value = data.address.road || "";
          document.getElementById("bairro").value =
            data.address.suburb || data.address.neighbourhood || "";
          document.getElementById("cidade").value =
            data.address.city || data.address.town || data.address.village || "";
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

function configurarFormulario() {
  const form = document.getElementById("formulario");
  const btnNova = document.getElementById("btnNovaColeta");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    exibirLoading(true);

    const [lat, lon] = (
      document.getElementById("coordenadas").value || ","
    ).split(",");

    const files = document.getElementById("fotos").files;
    const fotosUrls = [];

    try {
      // 1) Upload de cada arquivo para o Blob
      for (let i = 0; i < Math.min(files.length, 5); i++) {
        const file = files[i];
        const uploadRes = await fetch(
          `${uploadEndpoint}?filename=${encodeURIComponent(file.name)}&equipe=${equipeId}`,
          {
            method: "POST",
            body: file
          }
        );
        if (!uploadRes.ok) {
          const err = await uploadRes.text();
          throw new Error(`Upload falhou: ${err}`);
        }
        const { url } = await uploadRes.json();
        fotosUrls.push(url);
      }

      // 2) Chama o endpoint que grava no Sheets
      const payload = {
        latitude: lat.trim(),
        longitude: lon.trim(),
        rua: document.getElementById("rua").value,
        bairro: document.getElementById("bairro").value,
        cidade: document.getElementById("cidade").value,
        fotos: fotosUrls
      };
      const resp = await fetch(enviarEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const data = await resp.json();
        alert("Falha ao enviar coleta: " + (data.error || JSON.stringify(data)));
      } else {
        form.reset();
        exibirSucesso(true);
      }
    } catch (err) {
      // sem internet ou erro: salva no IndexedDB
      await ensureDB();
      await new Promise((res, rej) => {
        const tx = db.transaction("coletas", "readwrite");
        const reqAdd = tx.objectStore("coletas").add({
          latitude: lat.trim(),
          longitude: lon.trim(),
          rua: document.getElementById("rua").value,
          bairro: document.getElementById("bairro").value,
          cidade: document.getElementById("cidade").value,
          fotos: fotosUrls
        });
        reqAdd.onsuccess = () => res();
        reqAdd.onerror = () => rej(reqAdd.error);
      });
      await atualizarStatusPendentes();
      alert("Coleta salva offline. Sincronize depois.");
    } finally {
      exibirLoading(false);
    }
  });

  btnNova.addEventListener("click", () => exibirSucesso(false));
}

function configurarSincronizacao() {
  document.getElementById("btnSincronizar").addEventListener("click", async () => {
    await ensureDB();
    exibirLoading(true);

    const progresso = document.getElementById("progressoSincronizacao");
    const wrapper = document.getElementById("barraProgressoWrapper");
    const barra = document.getElementById("barraProgresso");
    wrapper.style.display = "block";
    barra.style.width = "0%";

    const store = db.transaction("coletas", "readonly").objectStore("coletas");
    const allDados = await new Promise(r => (store.getAll().onsuccess = e => r(e.target.result)));
    const allKeys = await new Promise(r => (store.getAllKeys().onsuccess = e => r(e.target.result)));

    let enviado = 0;
    progresso.textContent = `Sincronizando 0 de ${allDados.length}`;

    for (let i = 0; i < allDados.length; i++) {
      try {
        const res = await fetch(enviarEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(allDados[i])
        });
        if (res.ok) {
          await new Promise(del => {
            const tx = db.transaction("coletas", "readwrite");
            tx.objectStore("coletas")
              .delete(allKeys[i])
              .onsuccess = del;
          });
          enviado++;
          progresso.textContent = `Sincronizando ${enviado} de ${allDados.length}`;
          barra.style.width = `${((enviado / allDados.length) * 100).toFixed(1)}%`;
        }
      } catch {
        progresso.textContent = "Erro ao sincronizar.";
        break;
      }
    }

    exibirLoading(false);
    await atualizarStatusPendentes();
    if (enviado === allDados.length) {
      exibirSincronizacao(true);
      setTimeout(() => (wrapper.style.display = "none"), 1500);
    } else {
      wrapper.style.display = "none";
    }
  });

  document.getElementById("btnFecharSincronizacao").addEventListener("click", () => {
    exibirSincronizacao(false);
  });
}

window.addEventListener("DOMContentLoaded", () => {
  exibirLoading(false);
  configurarGeolocalizacao();
  configurarFormulario();
  configurarSincronizacao();
});

// main.js

const apiKey = "pk.481f46d0a98c9a0b3fb99b5d1cbd9658";
const webhookUrl = "/enviar";       // na Vercel rodando em api/enviar.js via vercel.json
const dbName = "coletas_offline";
let db;

/**
 * 1) Abre IndexedDB e só chama atualizarStatusPendentes no sucesso
 */
function abrirDB() {
  console.log("Abrindo IndexedDB...");
  const req = indexedDB.open(dbName, 1);
  req.onerror = () => console.error("Erro ao abrir IndexedDB:", req.error);
  req.onupgradeneeded = (e) => {
    console.log("Atualizando versão do DB...");
    const inst = e.target.result;
    if (!inst.objectStoreNames.contains("coletas")) {
      inst.createObjectStore("coletas", { autoIncrement: true });
    }
  };
  req.onsuccess = (e) => {
    db = e.target.result;
    console.log("IndexedDB aberto com sucesso:", dbName);
    atualizarStatusPendentes();
  };
}

/**
 * 2) Atualiza no DOM o número de coletas pendentes
 */
function atualizarStatusPendentes() {
  if (!db) return;
  const tx = db.transaction("coletas", "readonly");
  const store = tx.objectStore("coletas");
  const cntReq = store.count();
  cntReq.onsuccess = (e) => {
    const n = e.target.result;
    document.getElementById("statusPendentes").textContent =
      n > 0
        ? `${n} coleta(s) offline pendente(s)`
        : "Nenhuma coleta offline salva";
  };
  cntReq.onerror = () =>
    console.error("Erro ao contar coletas:", cntReq.error);
}

/** 3) Funções de feedback visual */
function exibirLoading(on) {
  document.getElementById("loading").style.display = on ? "flex" : "none";
}
function exibirSucesso(on) {
  document.getElementById("sucesso").style.display = on ? "flex" : "none";
}
function exibirSincronizacao(on) {
  document.getElementById("sincronizacao").style.display = on ? "flex" : "none";
}

/**
 * 4) Configura botão de geolocalização + reverse geocoding
 */
function configurarGeolocalizacao() {
  document.getElementById("btnCoordenadas").addEventListener("click", () => {
    exibirLoading(true);
    if (!navigator.geolocation) {
      alert("Geolocalização não suportada.");
      return exibirLoading(false);
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
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
            data.address.suburb || data.address.neighbourhood || "";
          document.getElementById("cidade").value =
            data.address.city ||
            data.address.town ||
            data.address.village ||
            "";
        } catch (err) {
          console.error("Erro no reverse geocoding:", err);
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

/**
 * 5) Configura envio do formulário (online ou offline)
 */
function configurarFormulario() {
  const form = document.getElementById("formulario");
  const btnNova = document.getElementById("btnNovaColeta");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    exibirLoading(true);

    const [lat, lon] = (
      document.getElementById("coordenadas").value || ","
    ).split(",");
    const files = document.getElementById("fotos").files;
    const fotosBase64 = [];
    let totalSize = 0;

    // converte até 5 fotos para Base64
    for (let i = 0; i < Math.min(files.length, 5); i++) {
      const f = files[i];
      totalSize += f.size;
      if (f.size > 50e6 || totalSize > 200e6) {
        alert("Limite de tamanho atingido.");
        return exibirLoading(false);
      }
      fotosBase64.push(
        await new Promise((r) => {
          const reader = new FileReader();
          reader.onload = () => r(reader.result);
          reader.readAsDataURL(f);
        })
      );
    }

    const dados = {
      latitude: lat.trim(),
      longitude: lon.trim(),
      rua: document.getElementById("rua").value,
      bairro: document.getElementById("bairro").value,
      cidade: document.getElementById("cidade").value,
      fotos: fotosBase64,
    };

    try {
      const resp = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dados),
      });
      const text = await resp.text();
      console.log("Resposta:", text);
      form.reset();
      exibirSucesso(true);
    } catch (err) {
      console.warn("Offline ou erro no fetch:", err);
      // salva no IndexedDB se offline/falha
      const tx = db.transaction("coletas", "readwrite");
      tx.objectStore("coletas").add(dados);
      await tx.complete;
      atualizarStatusPendentes();
      alert("Coleta salva offline. Sincronize depois.");
    } finally {
      exibirLoading(false);
    }
  });

  btnNova.addEventListener("click", () => exibirSucesso(false));
}

/**
 * 6) Configura botão de sincronizar pendentes
 */
function configurarSincronizacao() {
  document.getElementById("btnSincronizar").addEventListener("click", async () => {
    if (!db) return;
    exibirLoading(true);

    const progresso = document.getElementById("progressoSincronizacao");
    const barraWrapper = document.getElementById("barraProgressoWrapper");
    const barra = document.getElementById("barraProgresso");
    barraWrapper.style.display = "block";
    progresso.textContent = "";
    barra.style.width = "0%";

    const store = db.transaction("coletas", "readonly").objectStore("coletas");
    const allDados = await new Promise((r) => (store.getAll().onsuccess = (e) => r(e.target.result)));
    const allKeys = await new Promise((r) => (store.getAllKeys().onsuccess = (e) => r(e.target.result)));

    let enviado = 0;
    progresso.textContent = `Sincronizando 0 de ${allDados.length}`;

    for (let i = 0; i < allDados.length; i++) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(allDados[i]),
        });
        if (res.ok) {
          // exclui da store
          await new Promise((del) => {
            const tx = db.transaction("coletas", "readwrite");
            tx.objectStore("coletas").delete(allKeys[i]).onsuccess = del;
          });
          enviado++;
          progresso.textContent = `Sincronizando ${enviado} de ${allDados.length}`;
          barra.style.width = `${((enviado / allDados.length) * 100).toFixed(1)}%`;
        }
      } catch (err) {
        console.error("Erro ao sincronizar:", err);
        progresso.textContent = "Erro ao sincronizar.";
        break;
      }
    }

    exibirLoading(false);
    atualizarStatusPendentes();
    if (enviado === allDados.length) {
      exibirSincronizacao(true);
      setTimeout(() => (barraWrapper.style.display = "none"), 1500);
    } else {
      barraWrapper.style.display = "none";
    }
  });

  document.getElementById("btnFecharSincronizacao").addEventListener("click", () => {
    exibirSincronizacao(false);
  });
}

/** Inicialização */
window.addEventListener("DOMContentLoaded", () => {
  // garante overlay desligado ao carregar
  exibirLoading(false);

  abrirDB();
  configurarGeolocalizacao();
  configurarFormulario();
  configurarSincronizacao();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/service-worker.js")
      .then(() => console.log("✔ SW registrado."))
      .catch((e) => console.warn("Falha ao registrar SW:", e));
  }
});

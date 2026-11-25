const URL_PLANILHA = "https://script.google.com/macros/s/AKfycbxH5-y7ZzMH8VK-WSalSWPIqDd9nbn0kwGujZxEKu12Vpp4M2ODtdQhquD58FVxmNiCNw/exec";
const URL_FIREBASE = "https://zilda-9776b-default-rtdb.firebaseio.com/";
const SENHA_MODOS = "2026";

const ESTADO_PADRAO = {
  participante: "AGUARDANDO PARTICIPANTE...",
  etapa: "INICIO",
  nivel: "1",
  pergunta_id: "",
  resposta_escolhida: "",
  acertou: "",
  premio_atual: ""
};

let bancoPerguntas = [];
let filasSorteio = { 1: [], 2: [] };
let modoAtual = "participante";
let modoSolicitado = null;

let bancoFirebase = null;
let refEstado = null;
let refHistorico = null;
let refConexao = null;
let ouvintesAtivos = false;
let ultimoEstadoRecebido = null;

let estadoJogo = {
  participante: "AGUARDANDO PARTICIPANTE...",
  etapa: "INICIO",
  nivel: 1,
  perguntaAtual: null,
  respostaEscolhida: "",
  acertou: null,
  premio: ""
};

document.addEventListener("DOMContentLoaded", async () => {
  configurarEventos();
  inicializarFirebase();

  const parametros = new URLSearchParams(window.location.search);
  const modoUrl = parametros.get("modo");
  if (modoUrl === "apresentador" || modoUrl === "tv") {
    ativarModo(modoUrl);
  } else {
    ativarModo("participante");
  }

  await carregarPerguntas();
});

function inicializarFirebase() {
  if (!URL_FIREBASE || URL_FIREBASE.includes("COLE_AQUI") || typeof firebase === "undefined") {
    return false;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp({ databaseURL: URL_FIREBASE });
  }

  bancoFirebase = firebase.database();
  refEstado = bancoFirebase.ref("desafio_zilda/estado");
  refHistorico = bancoFirebase.ref("desafio_zilda/historico");
  refConexao = bancoFirebase.ref(".info/connected");
  return true;
}

function configurarEventos() {
  document.getElementById("botao-modo-participante").addEventListener("click", () => solicitarTrocaModo("participante"));
  document.getElementById("botao-modo-apresentador").addEventListener("click", () => solicitarTrocaModo("apresentador"));
  document.getElementById("botao-modo-tv").addEventListener("click", () => solicitarTrocaModo("tv"));

  document.getElementById("formulario-senha").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const senhaDigitada = document.getElementById("campo-senha").value.trim();
    if (senhaDigitada === SENHA_MODOS) {
      fecharModalSenha();
      if (modoSolicitado) ativarModo(modoSolicitado);
      modoSolicitado = null;
    } else {
      document.getElementById("erro-senha").classList.remove("oculto");
      document.getElementById("campo-senha").select();
    }
  });

  document.getElementById("botao-cancelar-senha").addEventListener("click", fecharModalSenha);

  document.getElementById("formulario-inicio").addEventListener("submit", (evento) => {
    evento.preventDefault();
    const nome = document.getElementById("campo-nome").value.trim().toUpperCase();
    if (!nome || bancoPerguntas.length === 0) return;
    iniciarRodada(nome);
  });

  document.getElementById("botao-parar").addEventListener("click", pararNaPrimeiraPergunta);
  document.getElementById("botao-avancar").addEventListener("click", avancarParaSegundaPergunta);
  document.getElementById("botao-proximo").addEventListener("click", reiniciarParaInicio);

  document.getElementById("botao-atualizar-lista").addEventListener("click", recarregarManual);
  document.getElementById("botao-limpar-lista").addEventListener("click", () => {
    document.getElementById("modal-limpar").classList.remove("oculto");
  });
  document.getElementById("botao-cancelar-limpar").addEventListener("click", () => {
    document.getElementById("modal-limpar").classList.add("oculto");
  });
  document.getElementById("botao-confirmar-limpar").addEventListener("click", limparListaParticipantes);
}

function solicitarTrocaModo(destino) {
  if (destino === modoAtual) return;

  if (modoAtual === "apresentador") {
    ativarModo(destino);
    return;
  }

  modoSolicitado = destino;
  const nomes = {
    participante: "Participante",
    apresentador: "Apresentador",
    tv: "TV"
  };

  document.getElementById("texto-destino-modo").textContent =
    `Digite a senha para mudar para o modo ${nomes[destino]}:`;
  document.getElementById("campo-senha").value = "";
  document.getElementById("erro-senha").classList.add("oculto");
  document.getElementById("modal-senha").classList.remove("oculto");
  setTimeout(() => document.getElementById("campo-senha").focus(), 50);
}

function fecharModalSenha() {
  document.getElementById("modal-senha").classList.add("oculto");
  document.getElementById("campo-senha").value = "";
  document.getElementById("erro-senha").classList.add("oculto");
}

function ativarModo(modo) {
  modoAtual = modo;
  document.body.className = `modo-${modo}`;

  const visoes = {
    participante: document.getElementById("visao-participante"),
    apresentador: document.getElementById("visao-apresentador"),
    tv: document.getElementById("visao-tv")
  };

  const botoes = {
    participante: document.getElementById("botao-modo-participante"),
    apresentador: document.getElementById("botao-modo-apresentador"),
    tv: document.getElementById("botao-modo-tv")
  };

  Object.keys(visoes).forEach((chave) => {
    visoes[chave].classList.toggle("oculto", chave !== modo);
    botoes[chave].classList.toggle("ativo", chave === modo);
  });

  if (modo === "apresentador" || modo === "tv") {
    conectarPaineisTempoReal();
  } else {
    desconectarPaineisTempoReal();
  }
}

function conectarPaineisTempoReal() {
  const status = document.getElementById("status-conexao");

  if (!bancoFirebase) {
    status.textContent = "CONFIGURE O FIREBASE";
    status.classList.add("desconectado");
    return;
  }

  if (ouvintesAtivos) return;
  ouvintesAtivos = true;

  // Monitora conexão em tempo real
  refConexao.on("value", (snapshot) => {
    if (snapshot.val() === true) {
      status.textContent = "CONECTADO";
      status.classList.remove("desconectado");
    } else {
      status.textContent = "SEM CONEXÃO";
      status.classList.add("desconectado");
    }
  });

  // Recebe qualquer mudança do Participante instantaneamente
  refEstado.on("value", (snapshot) => {
    ultimoEstadoRecebido = snapshot.val() || ESTADO_PADRAO;
    atualizarApresentador(ultimoEstadoRecebido);
    atualizarTv(ultimoEstadoRecebido);
  });

  // Recebe o histórico de participantes instantaneamente
  refHistorico.limitToLast(25).on("value", (snapshot) => {
    const lista = [];
    snapshot.forEach((filho) => {
      const item = filho.val();
      if (item) lista.push(item);
    });
    lista.reverse();
    atualizarListas(lista);
  });
}

function desconectarPaineisTempoReal() {
  if (!ouvintesAtivos || !bancoFirebase) return;
  refConexao.off();
  refEstado.off();
  refHistorico.off();
  ouvintesAtivos = false;
}

async function recarregarManual() {
  if (bancoPerguntas.length === 0) {
    await carregarPerguntas();
  }
  if (!bancoFirebase) return;

  const [snapEstado, snapHistorico] = await Promise.all([
    refEstado.once("value"),
    refHistorico.limitToLast(25).once("value")
  ]);

  ultimoEstadoRecebido = snapEstado.val() || ESTADO_PADRAO;
  atualizarApresentador(ultimoEstadoRecebido);
  atualizarTv(ultimoEstadoRecebido);

  const lista = [];
  snapHistorico.forEach((filho) => {
    const item = filho.val();
    if (item) lista.push(item);
  });
  lista.reverse();
  atualizarListas(lista);
}

async function carregarPerguntas() {
  const aviso = document.getElementById("aviso-conexao-inicio");
  const botaoIniciar = document.getElementById("botao-iniciar");

  try {
    const resposta = await fetch(`${URL_PLANILHA}?acao=perguntas`, { cache: "no-store" });
    const dados = await resposta.json();

    if (Array.isArray(dados.perguntas) && dados.perguntas.length > 0) {
      bancoPerguntas = dados.perguntas.filter((item) => Number(item.nivel) === 1 || Number(item.nivel) === 2);
      filasSorteio = { 1: [], 2: [] };
      aviso.classList.add("oculto");
      botaoIniciar.disabled = false;

      // Se o Firebase já entregou o estado antes das perguntas terminarem de baixar, atualiza a tela agora
      if (ultimoEstadoRecebido) {
        atualizarApresentador(ultimoEstadoRecebido);
        atualizarTv(ultimoEstadoRecebido);
      }
      return;
    }
  } catch (erro) {}

  bancoPerguntas = [];
  aviso.classList.remove("oculto");
  botaoIniciar.disabled = true;
}

function enviarParaPlanilhaEmSegundoPlano(dados) {
  try {
    fetch(URL_PLANILHA, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(dados)
    }).catch(() => {});
  } catch (erro) {}
}

function montarPayloadEstado() {
  return {
    participante: estadoJogo.participante,
    etapa: estadoJogo.etapa,
    nivel: String(estadoJogo.nivel),
    pergunta_id: estadoJogo.perguntaAtual ? String(estadoJogo.perguntaAtual.id) : "",
    resposta_escolhida: estadoJogo.respostaEscolhida,
    acertou: estadoJogo.acertou === null ? "" : (estadoJogo.acertou ? "SIM" : "NAO"),
    premio_atual: estadoJogo.premio
  };
}

function enviarEstadoAtual() {
  if (!refEstado) return;
  refEstado.set(montarPayloadEstado());
}

function limparListaParticipantes() {
  document.getElementById("modal-limpar").classList.add("oculto");
  if (refHistorico) {
    refHistorico.remove();
  }
  enviarParaPlanilhaEmSegundoPlano({ acao: "limpar_historico" });
}

function embaralhar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function sortearPergunta(nivel) {
  const grupo = bancoPerguntas.filter((item) => Number(item.nivel) === nivel);
  if (grupo.length === 0) return null;

  if (filasSorteio[nivel].length === 0) {
    filasSorteio[nivel] = embaralhar(grupo);
  }

  return filasSorteio[nivel].pop();
}

function listarAlternativas(pergunta) {
  return [
    { letra: "A", texto: pergunta.alt_a },
    { letra: "B", texto: pergunta.alt_b },
    { letra: "C", texto: pergunta.alt_c },
    { letra: "D", texto: pergunta.alt_d }
  ];
}

function obterTextoAlternativa(pergunta, letra) {
  const encontrada = listarAlternativas(pergunta).find((item) => item.letra === letra.toUpperCase());
  return encontrada ? encontrada.texto : "";
}

function iniciarRodada(nome) {
  const primeira = sortearPergunta(1);
  if (!primeira) return;

  estadoJogo = {
    participante: nome,
    etapa: "PERGUNTA_1",
    nivel: 1,
    perguntaAtual: primeira,
    respostaEscolhida: "",
    acertou: null,
    premio: ""
  };

  exibirPergunta();
  enviarEstadoAtual();
}

function exibirPergunta() {
  exibirEtapa("etapa-pergunta");

  const pergunta = estadoJogo.perguntaAtual;
  const ehPrimeira = estadoJogo.nivel === 1;

  const numero = document.getElementById("numero-pergunta");
  numero.textContent = ehPrimeira ? "1" : "2";
  numero.className = `circulo-numero ${ehPrimeira ? "cor-verde" : "cor-vermelha"}`;

  document.getElementById("titulo-pergunta").textContent = ehPrimeira ? "PERGUNTA 1" : "PERGUNTA 2";
  document.getElementById("nome-participante").textContent = estadoJogo.participante;
  document.getElementById("enunciado-pergunta").textContent = pergunta.pergunta.toUpperCase();

  const container = document.getElementById("lista-alternativas");
  container.innerHTML = "";

  listarAlternativas(pergunta).forEach((opcao) => {
    const botao = document.createElement("button");
    botao.type = "button";
    botao.className = "botao-alternativa";
    botao.dataset.letra = opcao.letra;
    botao.innerHTML = `<span class="letra-alternativa">${opcao.letra}</span><span>${opcao.texto.toUpperCase()}</span>`;
    botao.addEventListener("click", () => responderAlternativa(opcao.letra));
    container.appendChild(botao);
  });
}

function responderAlternativa(letraEscolhida) {
  const correta = estadoJogo.perguntaAtual.correta.toUpperCase();
  const acertou = letraEscolhida === correta;

  estadoJogo.respostaEscolhida = letraEscolhida;
  estadoJogo.acertou = acertou;

  document.querySelectorAll("#lista-alternativas .botao-alternativa").forEach((botao) => {
    botao.disabled = true;
    if (botao.dataset.letra === correta) {
      botao.classList.add("correta");
    } else if (botao.dataset.letra === letraEscolhida && !acertou) {
      botao.classList.add("errada");
    }
  });

  enviarEstadoAtual();

  setTimeout(() => {
    if (acertou && estadoJogo.nivel === 1) {
      estadoJogo.etapa = "DECISAO_PARAR";
      estadoJogo.premio = "PRÊMIO GARANTIDO";
      document.getElementById("nome-decisao").textContent = estadoJogo.participante;
      exibirEtapa("etapa-decisao");
      enviarEstadoAtual();
    } else if (acertou && estadoJogo.nivel === 2) {
      encerrarRodada({
        titulo: "VOCÊ DOBROU SEU PRÊMIO!",
        resultadoHistorico: "ACERTOU AS 2 PERGUNTAS",
        premioHistorico: "PRÊMIO EM DOBRO",
        mensagem: "Parabéns! Você acertou as duas perguntas sobre a Dra. Zilda Arns.",
        corEmblema: "cor-verde",
        icone: "★",
        totalPerguntas: 2,
        exibirCorreta: false
      });
    } else {
      encerrarRodada({
        titulo: "NÃO FOI DESSA VEZ",
        resultadoHistorico: "NÃO ACERTOU",
        premioHistorico: "PARTICIPOU",
        mensagem: "Obrigado por participar do Desafio Zilda Arns da turma 2A!",
        corEmblema: "cor-vermelha",
        icone: "✕",
        totalPerguntas: estadoJogo.nivel,
        exibirCorreta: true
      });
    }
  }, 1300);
}

function pararNaPrimeiraPergunta() {
  encerrarRodada({
    titulo: "PRÊMIO GARANTIDO!",
    resultadoHistorico: "PAROU NA PERGUNTA 1",
    premioHistorico: "PRÊMIO GARANTIDO",
    mensagem: "Ótima escolha! Você parou com segurança e garantiu o seu prêmio.",
    corEmblema: "cor-amarela",
    icone: "✓",
    totalPerguntas: 1,
    exibirCorreta: false
  });
}

function avancarParaSegundaPergunta() {
  const segunda = sortearPergunta(2);
  if (!segunda) return;

  estadoJogo.etapa = "PERGUNTA_2";
  estadoJogo.nivel = 2;
  estadoJogo.perguntaAtual = segunda;
  estadoJogo.respostaEscolhida = "";
  estadoJogo.acertou = null;
  estadoJogo.premio = "";

  exibirPergunta();
  enviarEstadoAtual();
}

function encerrarRodada({
  titulo,
  resultadoHistorico,
  premioHistorico,
  mensagem,
  corEmblema,
  icone,
  totalPerguntas,
  exibirCorreta
}) {
  estadoJogo.etapa = "RESULTADO";
  estadoJogo.premio = premioHistorico;

  const emblema = document.getElementById("icone-resultado");
  emblema.className = `circulo-numero ${corEmblema}`;
  emblema.textContent = icone;

  document.getElementById("nome-resultado").textContent = estadoJogo.participante;
  document.getElementById("titulo-resultado").textContent = titulo;
  document.getElementById("mensagem-resultado").textContent = mensagem;

  const caixaCorreta = document.getElementById("caixa-resposta-correta");
  if (exibirCorreta && estadoJogo.perguntaAtual) {
    const letraCerta = estadoJogo.perguntaAtual.correta.toUpperCase();
    document.getElementById("letra-resposta-correta").textContent = letraCerta;
    document.getElementById("texto-resposta-correta").textContent =
      obterTextoAlternativa(estadoJogo.perguntaAtual, letraCerta);
    caixaCorreta.classList.remove("oculto");
  } else {
    caixaCorreta.classList.add("oculto");
  }

  document.getElementById("caixa-curiosidade").textContent =
    estadoJogo.perguntaAtual ? estadoJogo.perguntaAtual.comentario_apresentador : "";

  exibirEtapa("etapa-resultado");

  const registroHistorico = {
    participante: estadoJogo.participante,
    resultado_final: resultadoHistorico,
    premio: premioHistorico,
    perguntas_respondidas: String(totalPerguntas),
    ajuda_utilizada: ""
  };

  // 1) Atualiza TV e Apresentador instantaneamente via Firebase
  enviarEstadoAtual();
  if (refHistorico) {
    refHistorico.push(registroHistorico);
  }

  // 2) Salva backup na Planilha em segundo plano (sem travar nada)
  enviarParaPlanilhaEmSegundoPlano({
    acao: "registrar_historico",
    ...registroHistorico
  });
}

function reiniciarParaInicio() {
  document.getElementById("campo-nome").value = "";
  estadoJogo = {
    participante: "AGUARDANDO PARTICIPANTE...",
    etapa: "INICIO",
    nivel: 1,
    perguntaAtual: null,
    respostaEscolhida: "",
    acertou: null,
    premio: ""
  };
  exibirEtapa("etapa-inicio");
  enviarEstadoAtual();
}

function exibirEtapa(idVisivel) {
  ["etapa-inicio", "etapa-pergunta", "etapa-decisao", "etapa-resultado"].forEach((id) => {
    document.getElementById(id).classList.toggle("oculto", id !== idVisivel);
  });
}

function nomearEtapa(etapa) {
  const mapa = {
    INICIO: "INÍCIO",
    PERGUNTA_1: "PERGUNTA 1",
    DECISAO_PARAR: "ACERTOU A 1 — DECISÃO",
    PERGUNTA_2: "PERGUNTA 2",
    RESULTADO: "FIM DA RODADA"
  };
  return mapa[etapa] || etapa || "INÍCIO";
}

function atualizarApresentador(estado) {
  document.getElementById("apresentador-participante").textContent =
    estado.participante || "AGUARDANDO PARTICIPANTE...";
  document.getElementById("apresentador-etapa").textContent = nomearEtapa(estado.etapa);

  const pergunta = bancoPerguntas.find((item) => Number(item.id) === Number(estado.pergunta_id));
  const enunciado = document.getElementById("apresentador-enunciado");
  const alternativas = document.getElementById("apresentador-alternativas");
  const gabarito = document.getElementById("apresentador-gabarito");
  const comentario = document.getElementById("apresentador-comentario");

  if (!pergunta || estado.etapa === "INICIO") {
    document.getElementById("apresentador-rotulo-pergunta").textContent = "PERGUNTA SORTEADA";
    enunciado.textContent = "Nenhuma pergunta ativa no momento.";
    alternativas.innerHTML = "";
    gabarito.textContent = "—";
    comentario.textContent = "Aguardando o participante iniciar o desafio.";
    return;
  }

  document.getElementById("apresentador-rotulo-pergunta").textContent =
    `PERGUNTA ${estado.nivel || pergunta.nivel} (#${pergunta.id})`;
  enunciado.textContent = pergunta.pergunta;

  const correta = pergunta.correta.toUpperCase();
  gabarito.textContent = `LETRA ${correta}`;
  comentario.textContent = pergunta.comentario_apresentador;

  alternativas.innerHTML = listarAlternativas(pergunta)
    .map((item) => {
      const classe = item.letra === correta ? "gabarito" : "";
      const marcacao = estado.resposta_escolhida === item.letra ? " ← ESCOLHIDA" : "";
      return `<div class="item-alternativa-apresentador ${classe}"><strong>${item.letra})</strong> ${item.texto}${marcacao}</div>`;
    })
    .join("");
}

function atualizarTv(estado) {
  const espera = document.getElementById("tv-espera");
  const ativo = document.getElementById("tv-ativo");
  const pergunta = bancoPerguntas.find((item) => Number(item.id) === Number(estado.pergunta_id));

  if (!pergunta || !estado.etapa || estado.etapa === "INICIO") {
    espera.classList.remove("oculto");
    ativo.classList.add("oculto");
    return;
  }

  espera.classList.add("oculto");
  ativo.classList.remove("oculto");

  const nivel = Number(estado.nivel) === 2 ? 2 : 1;
  const numero = document.getElementById("tv-numero-pergunta");
  numero.textContent = String(nivel);
  numero.className = `circulo-numero ${nivel === 1 ? "cor-verde" : "cor-vermelha"}`;

  document.getElementById("tv-titulo-pergunta").textContent = `PERGUNTA ${nivel}`;
  document.getElementById("tv-participante").textContent = estado.participante || "";
  document.getElementById("tv-enunciado").textContent = pergunta.pergunta.toUpperCase();

  const correta = pergunta.correta.toUpperCase();
  const escolhida = (estado.resposta_escolhida || "").toUpperCase();
  const respondeu = escolhida !== "" || estado.etapa === "RESULTADO" || estado.etapa === "DECISAO_PARAR";

  document.getElementById("tv-alternativas").innerHTML = listarAlternativas(pergunta)
    .map((item) => {
      let classe = "alternativa-tv";
      if (respondeu) {
        if (item.letra === correta) classe += " correta";
        else if (item.letra === escolhida && escolhida !== correta) classe += " errada";
      }
      return `<div class="${classe}"><span class="letra-alternativa">${item.letra}</span><span>${item.texto.toUpperCase()}</span></div>`;
    })
    .join("");

  const faixa = document.getElementById("tv-faixa-resultado");
  if (estado.etapa === "DECISAO_PARAR") {
    faixa.className = "faixa-resultado-tv acerto";
    faixa.textContent = "VOCÊ ACERTOU! PARAR E GARANTIR OU IR PARA A PERGUNTA 2?";
  } else if (estado.etapa === "RESULTADO") {
    if (estado.acertou === "NAO") {
      faixa.className = "faixa-resultado-tv erro";
      faixa.textContent = `RESPOSTA CORRETA: ${correta}) ${obterTextoAlternativa(pergunta, correta).toUpperCase()}`;
    } else {
      faixa.className = "faixa-resultado-tv acerto";
      faixa.textContent = `${estado.participante} — ${estado.premio_atual || "PARABÉNS!"}`;
    }
  } else {
    faixa.className = "faixa-resultado-tv oculto";
    faixa.textContent = "";
  }
}

function atualizarListas(lista) {
  const html = !lista || lista.length === 0
    ? `<li class="item-vazio">Nenhum participante finalizado ainda.</li>`
    : lista
        .map((item) => {
          const resultado = (item.resultado_final || "").toUpperCase();
          let classe = "";
          if (resultado.includes("2 PERGUNTAS") || resultado.includes("DOBRO")) classe = "dobrou";
          else if (resultado.includes("NÃO")) classe = "errou";

          const premio = item.premio && item.premio !== "PARTICIPOU"
            ? ` — <strong>${item.premio}</strong>`
            : "";

          return `
            <li class="item-participante ${classe}">
              <div class="topo-item-participante">
                <span>${item.participante}</span>
              </div>
              <div>${item.resultado_final}${premio}</div>
            </li>
          `;
        })
        .join("");

  document.getElementById("lista-apresentador").innerHTML = html;
  document.getElementById("lista-tv").innerHTML = html;
}
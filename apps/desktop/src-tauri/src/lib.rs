use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::thread;

use tauri::{AppHandle, Emitter, Manager, State};

// Ponte entre a interface e o sidecar do agente (Node). Cada linha JSON que o
// sidecar escreve no stdout vira o evento `agent-event`; cada requisição enviada
// pela interface é escrita como uma linha no stdin do sidecar.
//
// Desenvolvimento: usa o `node` do PATH e o script compilado em
// `packages/agent/dist/sidecar.mjs` (gerado por `pnpm --filter @lunabot/agent build`).
// Empacotamento para distribuição está fora do escopo desta etapa.

/// Caminho do script do sidecar, relativo a `apps/desktop/src-tauri`.
const SIDECAR_SCRIPT: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../packages/agent/dist/sidecar.mjs"
);
/// Variável que o sidecar lê para saber onde guardar o banco de dados.
const DATA_DIR_ENV: &str = "LUNABOT_DATA_DIR";
const AGENT_EVENT: &str = "agent-event";
const AGENT_EXIT: &str = "agent-exit";
/// Flag do Windows que impede a abertura de uma janela de console para o node.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct AgentState {
    stdin: Mutex<ChildStdin>,
}

fn spawn_sidecar(data_dir: &std::path::Path) -> std::io::Result<Child> {
    let mut command = Command::new("node");
    command
        .arg(SIDECAR_SCRIPT)
        .env(DATA_DIR_ENV, data_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn()
}

/// Inicia o sidecar e a thread que repassa cada linha do stdout à interface.
fn start_agent(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;

    let mut child = spawn_sidecar(&data_dir)?;
    let stdin = child.stdin.take().ok_or("stdin do sidecar indisponível")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("stdout do sidecar indisponível")?;
    app.manage(AgentState {
        stdin: Mutex::new(stdin),
    });

    let handle = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) => {
                    if let Err(error) = handle.emit(AGENT_EVENT, line) {
                        eprintln!("Falha ao emitir evento do agente: {error}");
                    }
                }
                Err(error) => {
                    eprintln!("Falha ao ler o stdout do agente: {error}");
                    break;
                }
            }
        }
        let code = child.wait().ok().and_then(|status| status.code());
        if let Err(error) = handle.emit(AGENT_EXIT, code) {
            eprintln!("Falha ao emitir saída do agente: {error}");
        }
    });
    Ok(())
}

/// Envia uma requisição ao sidecar. A validação do formato fica a cargo do sidecar.
#[tauri::command]
fn agent_send(request: serde_json::Value, state: State<AgentState>) -> Result<(), String> {
    let line = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    let mut stdin = state
        .stdin
        .lock()
        .map_err(|_| "Canal com o agente travado por um erro anterior.".to_string())?;
    writeln!(stdin, "{line}")
        .and_then(|()| stdin.flush())
        .map_err(|error| format!("Falha ao enviar ao agente: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            start_agent(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![agent_send])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

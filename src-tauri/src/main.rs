// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--mcp" || a == "--mcp-server" || a == "mcp") {
        pz_mod_studio_lib::mcp::run_stdio_server();
        return;
    }

    pz_mod_studio_lib::run()
}

fn main() {
    #[cfg(windows)]
    colors::enable_ansi(); // For Windows 10

    let args: Vec<String> = std::env::args().collect();
    if let Err(err) = deno_runtime::standalone::try_run_standalone_binary(args) {
        eprintln!("{}: {}", deno_runtime::colors::red_bold("error"), err.to_string());
        std::process::exit(1);
    }
}
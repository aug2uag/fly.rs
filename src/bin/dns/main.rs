extern crate futures;
use futures::{future, Future};

extern crate tokio;

extern crate trust_dns as dns;
extern crate trust_dns_proto;
extern crate trust_dns_server;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};

extern crate flatbuffers;

#[macro_use]
extern crate log;
extern crate env_logger;
extern crate fly;
extern crate libfly;

use fly::runtime::*;
use fly::settings::SETTINGS;
use fly::{dns_server::DnsServer, fixed_runtime_selector::FixedRuntimeSelector};

use env_logger::Env;

extern crate clap;

static mut SELECTOR: Option<FixedRuntimeSelector> = None;

fn main() {
  let env = Env::default().filter_or("LOG_LEVEL", "info");
  env_logger::init_from_env(env);
  debug!("V8 version: {}", libfly::version());

  let matches = clap::App::new("fly-dns")
    .version("0.0.1-alpha")
    .about("Fly DNS server")
    .arg(
      clap::Arg::with_name("port")
        .short("p")
        .long("port")
        .takes_value(true),
    )
    .arg(
      clap::Arg::with_name("input")
        .help("Sets the input file to use")
        .required(true)
        .index(1),
    )
    .get_matches();

  let entry_file = matches.value_of("input").unwrap();
  let mut runtime = Runtime::new(None, None, &SETTINGS.read().unwrap());

  debug!("Loading dev tools");
  runtime.eval_file("v8env/dist/dev-tools.js");
  runtime.eval("<installDevTools>", "installDevTools();");
  debug!("Loading dev tools done");
  runtime.eval(entry_file, &format!("dev.run('{}')", entry_file));

  let port: u16 = match matches.value_of("port") {
    Some(pstr) => pstr.parse::<u16>().unwrap(),
    None => 8053,
  };

  let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1)), port);

  tokio::run(future::lazy(move || -> Result<(), ()> {
    tokio::spawn(
      runtime
        .run()
        .map_err(|e| error!("error running runtime event loop: {}", e)),
    );
    unsafe { SELECTOR = Some(FixedRuntimeSelector::new(runtime)) }
    let server = DnsServer::new(addr, unsafe {SELECTOR.as_ref().unwrap()});
    server.start();
    Ok(())
  }));
}

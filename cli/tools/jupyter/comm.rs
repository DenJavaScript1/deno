// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

use deno_core::error::AnyError;
use ring::hmac;
use zeromq::prelude::*;
use zeromq::util::PeerIdentity;
use zeromq::SocketOptions;

use super::hmac_verify;
use super::ReplyMessage;
use super::RequestMessage;
use super::SideEffectMessage;

pub struct PubComm {
  conn_str: String,
  identity: String,
  hmac_key: hmac::Key,
  socket: zeromq::PubSocket,
}

// TODO(apowers313) connect and send look like traits shared with DealerComm
impl PubComm {
  pub fn new(conn_str: String, identity: String, hmac_key: hmac::Key) -> Self {
    println!("iopub connection: {}", conn_str);
    let peer_identity =
      PeerIdentity::try_from(identity.as_bytes().to_vec()).unwrap();
    let mut options = SocketOptions::default();
    options.peer_identity(peer_identity);

    Self {
      conn_str,
      identity,
      hmac_key,
      socket: zeromq::PubSocket::with_options(options),
    }
  }

  pub async fn connect(&mut self) -> Result<(), AnyError> {
    self.socket.bind(&self.conn_str).await?;

    Ok(())
  }

  pub async fn send(&mut self, msg: SideEffectMessage) -> Result<(), AnyError> {
    println!("==> IoPub SENDING: {:#?}", msg);
    let zmq_msg = msg.serialize(&self.hmac_key);
    self.socket.send(zmq_msg).await?;
    Ok(())
  }
}

pub struct DealerComm {
  name: String,
  conn_str: String,
  identity: String,
  hmac_key: hmac::Key,
  socket: zeromq::DealerSocket,
}

impl DealerComm {
  pub fn new(
    name: &str,
    conn_str: String,
    identity: String,
    hmac_key: hmac::Key,
  ) -> Self {
    println!("dealer '{}' connection: {}", name, conn_str);
    let peer_identity =
      PeerIdentity::try_from(identity.as_bytes().to_vec()).unwrap();
    let mut options = SocketOptions::default();
    options.peer_identity(peer_identity);

    Self {
      name: name.to_string(),
      conn_str,
      identity,
      hmac_key,
      socket: zeromq::DealerSocket::with_options(options),
    }
  }

  pub async fn connect(&mut self) -> Result<(), AnyError> {
    self.socket.bind(&self.conn_str).await?;

    Ok(())
  }

  pub async fn recv(&mut self) -> Result<RequestMessage, AnyError> {
    let zmq_msg = self.socket.recv().await?;

    hmac_verify(
      &self.hmac_key,
      zmq_msg.get(1).unwrap(),
      zmq_msg.get(2).unwrap(),
      zmq_msg.get(3).unwrap(),
      zmq_msg.get(4).unwrap(),
      zmq_msg.get(5).unwrap(),
    )?;

    let jup_msg = RequestMessage::try_from(zmq_msg)?;
    println!("<== {} RECEIVING: {:#?}", self.name, jup_msg);
    Ok(jup_msg)
  }

  pub async fn send(&mut self, msg: ReplyMessage) -> Result<(), AnyError> {
    println!("==> {} SENDING: {:#?}", self.name, msg);
    let zmq_msg = msg.serialize(&self.hmac_key);
    self.socket.send(zmq_msg).await?;
    println!("==> {} SENT", self.name);
    Ok(())
  }
}

pub struct HbComm {
  conn_str: String,
  socket: zeromq::RepSocket,
}

impl HbComm {
  pub fn new(conn_str: String) -> Self {
    println!("hb connection: {}", conn_str);
    Self {
      conn_str,
      socket: zeromq::RepSocket::new(),
    }
  }

  pub async fn connect(&mut self) -> Result<(), AnyError> {
    self.socket.bind(&self.conn_str).await?;

    Ok(())
  }

  pub async fn heartbeat(&mut self) -> Result<(), AnyError> {
    let msg = self.socket.recv().await?;
    println!("<== heartbeat received");
    self.socket.send(msg).await?;
    println!("==> heartbeat sent");
    Ok(())
  }
}

use std::fmt;

#[derive(Debug)]
pub enum WebCryptoError {
  MissingArgument(String),
  Unsupported,
}

impl fmt::Display for WebCryptoError {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    match self {
      WebCryptoError::MissingArgument(s) => {
        write!(f, "Missing argument {}", &s)
      }
      WebCryptoError::Unsupported => write!(f, "Unsupported algorithm"),
    }
  }
}

impl std::error::Error for WebCryptoError {}

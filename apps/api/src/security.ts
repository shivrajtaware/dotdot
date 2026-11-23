export type JwtSecrets = { access: string; refresh: string };

const placeholderSecret = /^(?:replace-with|change[_-]?me|your[-_ ]secret|example[-_ ]secret)/i;

export function validateJwtSecrets(accessValue?: string, refreshValue?: string): JwtSecrets {
  const validate = (name: string, value?: string) => {
    const secret = value?.trim();
    if (!secret || secret.length < 32 || placeholderSecret.test(secret)) {
      throw new Error(`${name} must be a unique, randomly generated value with at least 32 characters.`);
    }
    return secret;
  };

  const access = validate('JWT_SECRET', accessValue);
  const refresh = validate('JWT_REFRESH_SECRET', refreshValue);
  if (access === refresh) throw new Error('JWT_SECRET and JWT_REFRESH_SECRET must be different values.');
  return { access, refresh };
}

export function validateOwnerCredentials(emailValue?: string, passwordValue?: string) {
  const email = emailValue?.trim().toLowerCase();
  const password = passwordValue;
  if (!email || !password) throw new Error('OWNER_EMAIL and OWNER_PASSWORD are required to seed the initial owner account.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@example.com')) {
    throw new Error('OWNER_EMAIL must be a real owner mailbox, not a template address.');
  }
  if (password.length < 12 || password.length > 72 || Buffer.byteLength(password, 'utf8') > 72 || placeholderSecret.test(password)) {
    throw new Error('OWNER_PASSWORD must be a non-template password between 12 and 72 characters and no more than 72 UTF-8 bytes.');
  }
  return { email, password };
}

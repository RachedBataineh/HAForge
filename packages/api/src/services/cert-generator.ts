import forge from "node-forge";

export interface GeneratedCerts {
  ca: { cert: string; key: string };
  etcdNodes: {
    node1: { cert: string; key: string };
    node2: { cert: string; key: string };
    node3: { cert: string; key: string };
  };
  postgresServer: { cert: string; key: string; req: string };
}

export function generateClusterCertificates(
  pgNodeIps: [string, string, string],
  pgNodePrivateIps?: [string, string, string],
): GeneratedCerts {
  const { pki, md } = forge;

  // --- Generate CA ---
  const caKeys = pki.rsa.generateKeyPair(4096);
  const caCert = pki.createCertificate();
  caCert.publicKey = caKeys.publicKey;
  caCert.serialNumber = "01";
  caCert.validity.notBefore = new Date();
  caCert.validity.notAfter = new Date();
  caCert.validity.notAfter.setFullYear(caCert.validity.notBefore.getFullYear() + 10);

  const caAttrs = [
    { name: "commonName", value: "HAForge Cluster CA" },
    { name: "organizationName", value: "HAForge" },
  ];
  caCert.setSubject(caAttrs);
  caCert.setIssuer(caAttrs);
  caCert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true },
  ]);
  caCert.sign(caKeys.privateKey, md.sha256.create());

  const caCertPem = pki.certificateToPem(caCert);
  const caKeyPem = pki.privateKeyToPem(caKeys.privateKey);

  // --- Generate etcd node certificates ---
  const etcdNodes = {
    node1: generateNodeCert(caCert, caKeys.privateKey, "etcd-node1", pgNodeIps[0], pgNodePrivateIps?.[0]),
    node2: generateNodeCert(caCert, caKeys.privateKey, "etcd-node2", pgNodeIps[1], pgNodePrivateIps?.[1]),
    node3: generateNodeCert(caCert, caKeys.privateKey, "etcd-node3", pgNodeIps[2], pgNodePrivateIps?.[2]),
  };

  // --- Generate PostgreSQL server certificate ---
  const pgKeys = pki.rsa.generateKeyPair(2048);
  const pgCert = pki.createCertificate();
  pgCert.publicKey = pgKeys.publicKey;
  pgCert.serialNumber = "10";
  pgCert.validity.notBefore = new Date();
  pgCert.validity.notAfter = new Date();
  pgCert.validity.notAfter.setFullYear(pgCert.validity.notBefore.getFullYear() + 5);

  pgCert.setSubject([{ name: "commonName", value: "postgresql-server" }]);
  pgCert.setIssuer(caCert.subject.attributes);
  const pgSanIps = [
    { type: 7, ip: "127.0.0.1" },
    ...pgNodeIps.map((ip) => ({ type: 7 as const, ip })),
  ];
  if (pgNodePrivateIps) {
    pgSanIps.push(...pgNodePrivateIps.map((ip) => ({ type: 7 as const, ip })));
  }
  pgCert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames: pgSanIps,
    },
  ]);
  pgCert.sign(caKeys.privateKey, md.sha256.create());

  // Generate CSR
  const csr = pki.createCertificationRequest();
  csr.publicKey = pgKeys.publicKey;
  csr.setSubject([{ name: "commonName", value: "postgresql-server" }]);
  csr.sign(pgKeys.privateKey, md.sha256.create());

  return {
    ca: { cert: caCertPem, key: caKeyPem },
    etcdNodes: {
      node1: { cert: pki.certificateToPem(etcdNodes.node1.cert), key: pki.privateKeyToPem(etcdNodes.node1.key) },
      node2: { cert: pki.certificateToPem(etcdNodes.node2.cert), key: pki.privateKeyToPem(etcdNodes.node2.key) },
      node3: { cert: pki.certificateToPem(etcdNodes.node3.cert), key: pki.privateKeyToPem(etcdNodes.node3.key) },
    },
    postgresServer: {
      cert: pki.certificateToPem(pgCert),
      key: pki.privateKeyToPem(pgKeys.privateKey),
      req: pki.certificationRequestToPem(csr),
    },
  };
}

function generateNodeCert(
  caCert: forge.pki.Certificate,
  caPrivateKey: forge.pki.rsa.PrivateKey,
  commonName: string,
  ip: string,
  privateIp?: string,
) {
  const { pki, md } = forge;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  // Generate a positive serial number: ensure first hex digit is 0-7 so Go's x509 parser sees it as positive
  const serialHex = forge.util.bytesToHex(forge.random.getBytesSync(4));
  const firstDigit = parseInt(serialHex[0]!, 16);
  cert.serialNumber = (firstDigit >= 8 ? "0" : "") + serialHex;
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);

  cert.setSubject([{ name: "commonName", value: commonName }]);
  cert.setIssuer(caCert.subject.attributes);
  const altNames: { type: number; ip?: string; value?: string }[] = [
    { type: 7, ip: ip },
    { type: 2, value: commonName },
    { type: 7, ip: "127.0.0.1" },
  ];
  if (privateIp) {
    altNames.push({ type: 7, ip: privateIp });
  }
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true, clientAuth: true },
    {
      name: "subjectAltName",
      altNames,
    },
  ]);
  cert.sign(caPrivateKey, md.sha256.create());

  return { cert, key: keys.privateKey };
}

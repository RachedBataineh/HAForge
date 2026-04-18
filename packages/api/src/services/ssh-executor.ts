import { Client, type SFTPWrapper } from "ssh2";
import { EventEmitter } from "events";

export interface SSHConfig {
  host: string;
  port: number;
  username: string;
  privateKey: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export class SSHExecutor extends EventEmitter {
  private client: Client;
  private sftp: SFTPWrapper | null = null;
  private connected = false;
  private config: SSHConfig;

  constructor(config: SSHConfig) {
    super();
    this.config = config;
    this.client = new Client();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected) {
        resolve();
        return;
      }

      this.client
        .on("ready", () => {
          this.connected = true;
          this.client.sftp((err, sftp) => {
            if (err) {
              reject(err);
              return;
            }
            this.sftp = sftp;
            resolve();
          });
        })
        .on("error", (err) => {
          this.connected = false;
          reject(err);
        })
        .on("close", () => {
          this.connected = false;
          this.sftp = null;
        })
        .connect({
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          privateKey: this.config.privateKey,
          readyTimeout: 15000,
          keepaliveInterval: 10000,
        });
    });
  }

  async exec(command: string, timeoutMs = 600000): Promise<ExecResult> {
    if (!this.connected) {
      throw new Error(`Not connected to ${this.config.host}`);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Command timed out after ${timeoutMs / 1000}s on ${this.config.host}: ${command.slice(0, 100)}`));
      }, timeoutMs);

      this.client.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        let stdout = "";
        let stderr = "";

        stream
          .on("data", (data: Buffer) => {
            const chunk = data.toString();
            stdout += chunk;
            this.emit("stdout", chunk);
          })
          .on("close", (code: number | null) => {
            clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code });
          })
          .stderr.on("data", (data: Buffer) => {
            const chunk = data.toString();
            stderr += chunk;
            this.emit("stderr", chunk);
          });
      });
    });
  }

  async uploadFile(content: string | Buffer, remotePath: string): Promise<void> {
    if (!this.sftp) {
      throw new Error("SFTP not available");
    }

    return new Promise((resolve, reject) => {
      const stream = this.sftp!.createWriteStream(remotePath);
      stream
        .on("error", reject)
        .on("close", () => resolve())
        .end(content);
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      const result = await this.exec("echo HAForge-SSH-OK");
      return result.stdout.trim() === "HAForge-SSH-OK" && result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      this.client.end();
      this.connected = false;
      this.sftp = null;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get host(): string {
    return this.config.host;
  }
}

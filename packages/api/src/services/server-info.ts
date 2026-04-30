import crypto from "crypto";

export function generatePassword(length = 32): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const charsLength = chars.length;
  let result = "";
  const randomBytes = crypto.getRandomValues(new Uint8Array(length * 2));
  let byteIndex = 0;

  while (result.length < length) {
    if (byteIndex >= randomBytes.length) {
      // Regenerate if we run out of bytes
      const newBytes = crypto.getRandomValues(new Uint8Array(length * 2));
      randomBytes.set(newBytes);
      byteIndex = 0;
    }
    // Rejection sampling to eliminate modulo bias
    // Max unbiased value is the largest multiple of charsLength <= 256
    const unbiasedMax = 256 - (256 % charsLength);
    const byte = randomBytes[byteIndex++]!;
    if (byte < unbiasedMax) {
      result += chars[byte % charsLength];
    }
  }
  return result;
}

export interface ServerInfo {
  hostname: string;
  os: string;
  arch: string;
  cpuCores: string;
  ramMB: string;
  kernel: string;
  uptime: string;
  timezone: string;
  diskTotal: string;
  diskUsed: string;
  diskFree: string;
  diskPercent: string;
}

export const SERVER_INFO_SCRIPT = [
  "echo '---HOSTNAME---' && hostname && echo '---END---'",
  "echo '---OS---' && cat /etc/os-release | grep PRETTY_NAME | cut -d'\"' -f2 && echo '---END---'",
  "echo '---ARCH---' && uname -m && echo '---END---'",
  "echo '---CPU---' && nproc && echo '---END---'",
  "echo '---RAM---' && awk '/MemTotal/ {printf \"%.0f\", $2/1024}' /proc/meminfo && echo '---END---'",
  "echo '---KERNEL---' && uname -r && echo '---END---'",
  "echo '---UPTIME---' && uptime -p && echo '---END---'",
  "echo '---TIMEZONE---' && timedatectl show -p Timezone --value && echo '---END---'",
  "echo '---DISK---' && df -h / | awk 'NR==2{print $2 \"|\" $3 \"|\" $4 \"|\" $5}' && echo '---END---'",
].join("\n");

export function parseServerInfo(stdout: string): ServerInfo {
  const extract = (tag: string) => {
    const regex = new RegExp(`---${tag}---\\s*\\n([\\s\\S]*?)---END---`);
    const match = stdout.match(regex);
    return match ? match[1]!.trim() : "";
  };
  const diskParts = extract("DISK").split("|");
  return {
    hostname: extract("HOSTNAME"),
    os: extract("OS"),
    arch: extract("ARCH"),
    cpuCores: extract("CPU"),
    ramMB: extract("RAM"),
    kernel: extract("KERNEL"),
    uptime: extract("UPTIME"),
    timezone: extract("TIMEZONE"),
    diskTotal: diskParts[0] ?? "",
    diskUsed: diskParts[1] ?? "",
    diskFree: diskParts[2] ?? "",
    diskPercent: diskParts[3] ?? "",
  };
}

import type { StepDefinition } from "../types";

/**
 * Hardening pre-deploy steps — run as root on ALL servers before any PG/HA installation.
 * After these steps complete, the orchestrator disconnects and reconnects as the admin user.
 */
export function getHardeningSteps(): StepDefinition[] {
  return [
    {
      phase: "hardening",
      stepNumber: 1,
      name: "System Update",
      targetRole: "all",
      commands: [
        {
          commands: [
            "apt update && apt upgrade -y",
            "apt install -y sudo curl wget gnupg2 cron",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 2,
      name: "Create Admin User",
      targetRole: "all",
      commands: [
        {
          commands: [
            "id ${ADMIN_USERNAME} &>/dev/null || useradd -m -s /bin/bash ${ADMIN_USERNAME}",
            "mkdir -p /home/${ADMIN_USERNAME}/.ssh",
            "cp /root/.ssh/authorized_keys /home/${ADMIN_USERNAME}/.ssh/authorized_keys 2>/dev/null || true",
            "chown -R ${ADMIN_USERNAME}:${ADMIN_USERNAME} /home/${ADMIN_USERNAME}/.ssh",
            "chmod 700 /home/${ADMIN_USERNAME}/.ssh",
            "chmod 600 /home/${ADMIN_USERNAME}/.ssh/authorized_keys",
            "echo '${ADMIN_USERNAME} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${ADMIN_USERNAME}",
            "chmod 440 /etc/sudoers.d/${ADMIN_USERNAME}",
            "visudo -c",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 3,
      name: "Harden SSH Configuration",
      targetRole: "all",
      commands: [
        {
          commands: [
            "cp /etc/ssh/sshd_config /etc/ssh/sshd_config.bak",
            "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config",
            "grep -q '^PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin no' >> /etc/ssh/sshd_config",
            "sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config",
            "grep -q '^PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config",
            "sshd -t 2>/dev/null && systemctl restart ssh || systemctl restart sshd || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 4,
      name: "Install CrowdSec",
      targetRole: "all",
      commands: [
        {
          commands: [
            "curl -s https://install.crowdsec.net | sh",
            "apt update && apt install -y crowdsec",
            "systemctl is-active crowdsec",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 5,
      name: "Enable Automatic Security Updates",
      targetRole: "all",
      commands: [
        {
          commands: [
            "apt install -y unattended-upgrades apt-listchanges",
            "cat << 'UNATTENDED' > /etc/apt/apt.conf.d/50unattended-upgrades\nUnattended-Upgrade::Allowed-Origins {\n        \"${distro_id}:${distro_codename}-security\";\n};\nUnattended-Upgrade::AutoFixInterruptedDpkg \"true\";\nUnattended-Upgrade::Remove-Unused-Dependencies \"true\";\nUNATTENDED",
            "echo 'APT::Periodic::Update-Package-Lists \"1\";' > /etc/apt/apt.conf.d/20auto-upgrades",
            "echo 'APT::Periodic::Unattended-Upgrade \"1\";' >> /etc/apt/apt.conf.d/20auto-upgrades",
            "echo 'APT::Periodic::Download-Upgradeable-Packages \"1\";' >> /etc/apt/apt.conf.d/20auto-upgrades",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 6,
      name: "Lock Root Account",
      targetRole: "all",
      commands: [
        {
          commands: [
            "passwd -l root",
          ],
        },
      ],
      files: [],
    },
  ];
}

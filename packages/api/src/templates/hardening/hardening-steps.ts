import type { StepDefinition } from "../types";

/**
 * Hardening pre-deploy steps — run as root on ALL servers before any PG/HA installation.
 * After these steps complete, the orchestrator disconnects and reconnects as the admin user.
 *
 * Step numbering starts at 1; cluster-steps.ts renumbers automatically based on array length.
 * targetRole "all_ha" resolves to HAProxy servers in 6-server mode, no-op in LB mode.
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
      name: "Validate Admin User",
      targetRole: "all",
      commands: [
        {
          commands: [
            "test -f /home/${ADMIN_USERNAME}/.ssh/authorized_keys && test -s /home/${ADMIN_USERNAME}/.ssh/authorized_keys",
            "su - ${ADMIN_USERNAME} -c 'sudo -n true'",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 4,
      name: "Harden SSH Configuration",
      targetRole: "all",
      commands: [
        {
          commands: [
            "mkdir -p /etc/ssh/sshd_config.d",
            "cat << 'SSHCONF' > /etc/ssh/sshd_config.d/99-hardening.conf\nPermitRootLogin no\nPasswordAuthentication no\nMaxAuthTries 3\nClientAliveInterval 300\nClientAliveCountMax 2\nSSHCONF",
            "sshd -t 2>/dev/null && systemctl restart ssh || systemctl restart sshd || true",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 5,
      name: "Kernel & Network Hardening",
      targetRole: "all",
      commands: [
        {
          commands: [
            "cat << 'SYSCTL' > /etc/sysctl.d/99-hardening.conf\nnet.ipv4.conf.all.rp_filter = 1\nnet.ipv4.icmp_echo_ignore_broadcasts = 1\nnet.ipv4.conf.default.accept_redirects = 0\nnet.ipv4.conf.default.send_redirects = 0\nnet.ipv4.conf.all.log_martians = 1\nkernel.randomize_va_space = 2\nSYSCTL",
            "sysctl --system",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 6,
      name: "Install CrowdSec + Firewall Bouncer",
      targetRole: "all",
      commands: [
        {
          commands: [
            "curl -s https://install.crowdsec.net | sh",
            "systemctl is-active crowdsec",
            "apt install -y crowdsec-firewall-bouncer",
            "systemctl is-active crowdsec-firewall-bouncer",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 7,
      name: "Install CrowdSec HAProxy Bouncer",
      targetRole: "all_ha",
      commands: [
        {
          commands: [
            "apt install -y crowdsec-haproxy-bouncer",
          ],
        },
      ],
      files: [],
    },
    {
      phase: "hardening",
      stepNumber: 8,
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
      stepNumber: 9,
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

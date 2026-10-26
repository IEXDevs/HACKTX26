#!/usr/bin/env bash
set -euo pipefail
umask 077

# This script runs only on the dedicated worker VM. It has no cloud identity.
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends docker.io nfs-kernel-server openssl
systemctl stop docker.service docker.socket
systemctl disable docker.socket

disk=/dev/disk/by-id/google-astronom-workspaces
test -b "$disk"
if ! blkid "$disk" >/dev/null; then mkfs.ext4 -m 1 "$disk"; fi
mkdir -p /srv/astronom
uuid=$(blkid -s UUID -o value "$disk")
if ! grep -q "UUID=$uuid " /etc/fstab; then
  printf 'UUID=%s /srv/astronom ext4 defaults 0 2\n' "$uuid" >> /etc/fstab
fi
mountpoint -q /srv/astronom || mount /srv/astronom
install -d -o 1000 -g 1000 -m 0750 /srv/astronom/workspaces
install -d -m 0700 /srv/astronom/tls /srv/astronom/docker

# Fixed NFS v3 ports, plus v4. Only the private Cloud Run subnet may reach them.
mkdir -p /etc/exports.d /etc/nfs.conf.d
cat > /etc/nfs.conf.d/astronom.conf <<'EOF'
[mountd]
port=20048
EOF
# Cloud Run checks the mount as root before starting the unprivileged app.
# Squash that identity to the app UID, never to root or an inaccessible nobody.
printf '/srv/astronom/workspaces 10.42.0.0/26(rw,sync,no_subtree_check,root_squash,anonuid=1000,anongid=1000)\n' > /etc/exports.d/astronom.exports
exportfs -ra
systemctl enable --now nfs-server

# The setup step copies the TLS material over IAP. Never start a public or
# unauthenticated Docker listener while waiting for it.
cat > /etc/docker/daemon.json <<'EOF'
{
  "hosts": ["unix:///var/run/docker.sock", "tcp://10.42.1.2:2376"],
  "tlsverify": true,
  "tlscacert": "/srv/astronom/tls/ca.pem",
  "tlscert": "/srv/astronom/tls/server-cert.pem",
  "tlskey": "/srv/astronom/tls/server-key.pem",
  "data-root": "/srv/astronom/docker",
  "log-driver": "local",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
mkdir -p /etc/systemd/system/docker.service.d
cat > /etc/systemd/system/docker.service.d/astronom.conf <<'EOF'
[Unit]
Requires=
Requires=containerd.service
RequiresMountsFor=/srv/astronom
ConditionPathExists=/srv/astronom/tls/server-key.pem
[Service]
ExecStart=
ExecStart=/usr/bin/dockerd --containerd=/run/containerd/containerd.sock
EOF
systemctl daemon-reload
systemctl enable docker
if test -f /srv/astronom/tls/server-key.pem; then systemctl restart docker; fi

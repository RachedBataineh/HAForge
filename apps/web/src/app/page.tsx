"use client";

import { Button } from "@HAForge/ui/components/button";
import { Card, CardContent } from "@HAForge/ui/components/card";
import Link from "next/link";
import { Database, Shield, Zap, Server } from "lucide-react";

const features = [
  {
    icon: Zap,
    title: "Automatic Failover",
    description:
      "Patroni-based leader election with etcd consensus. New leader promoted in seconds when the current leader fails.",
  },
  {
    icon: Shield,
    title: "SSL Encrypted",
    description:
      "End-to-end TLS encryption for etcd, Patroni, and PostgreSQL. Certificates auto-generated with proper SANs.",
  },
  {
    icon: Server,
    title: "3+3 Architecture",
    description:
      "3 PostgreSQL nodes (1 leader + 2 replicas) with 3 HAProxy load balancers and floating IP failover.",
  },
];

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-3rem)] px-4 py-16">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Database className="size-6" />
        </div>
        <h1 className="text-4xl font-bold tracking-tight">HAForge</h1>
      </div>

      <p className="text-xl text-muted-foreground text-center max-w-2xl mb-2">
        PostgreSQL High Availability Cluster Automation
      </p>
      <p className="text-sm text-muted-foreground/70 text-center max-w-xl mb-10">
        Deploy production-ready PostgreSQL HA clusters on Hetzner Cloud with
        automatic failover, SSL encryption, and floating IP management.
      </p>

      <div className="flex gap-3 mb-16">
        <Link href="/dashboard/clusters">
          <Button size="lg">Get Started</Button>
        </Link>
        <Link href="/dashboard">
          <Button variant="outline" size="lg">Dashboard</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {features.map((feature) => (
          <Card key={feature.title} className="border-border/50">
            <CardContent className="pt-6">
              <feature.icon className="size-8 text-primary mb-4" />
              <h3 className="font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground">
                {feature.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

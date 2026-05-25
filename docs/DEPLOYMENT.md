# Deployment Guide

This guide covers deploying NeuroStack to production environments.

## Deployment Architecture

### Development
- Docker Compose on local machine
- In-memory/local DuckDB
- Embedded Qdrant
- Single-node deployments

### Staging
- Kubernetes cluster (EKS/GKE/AKS)
- PostgreSQL + ClickHouse
- Managed Redis
- Real services with rate limiting

### Production
- Multi-region Kubernetes
- Managed databases (RDS, Cloud SQL)
- Dedicated vector database cluster
- Auto-scaling and failover
- Global load balancing

## Prerequisites

- Kubernetes cluster (1.26+)
- kubectl configured
- Helm 3+
- Docker registry access
- Cloud provider CLI (AWS, GCP, Azure)
- Terraform (for IaC)

## Building Docker Images

### Local Build

```bash
# Build all images
docker-compose build

# Build specific service
docker build -f infrastructure/docker/Dockerfile.api -t neurostack-api:latest .
```

### Push to Registry

```bash
# Configure registry
export DOCKER_REGISTRY=your-registry.azurecr.io
export DOCKER_USERNAME=username
export DOCKER_PASSWORD=token

# Login
echo $DOCKER_PASSWORD | docker login -u $DOCKER_USERNAME --password-stdin $DOCKER_REGISTRY

# Tag and push
docker tag neurostack-api:latest $DOCKER_REGISTRY/neurostack-api:latest
docker push $DOCKER_REGISTRY/neurostack-api:latest

# Repeat for all services:
# - neurostack-web
# - neurostack-query-runtime
# - neurostack-agent-orchestrator
```

## Kubernetes Deployment

### 1. Create Namespace

```bash
kubectl create namespace neurostack
kubectl config set-context --current --namespace=neurostack
```

### 2. Create Secrets

```bash
# Database credentials
kubectl create secret generic postgres-creds \
  --from-literal=username=neurostack \
  --from-literal=password=secure-password \
  -n neurostack

# API keys
kubectl create secret generic api-keys \
  --from-literal=openai-key=sk-... \
  --from-literal=anthropic-key=sk-ant-... \
  -n neurostack

# Docker registry
kubectl create secret docker-registry regcred \
  --docker-server=your-registry.azurecr.io \
  --docker-username=username \
  --docker-password=token \
  -n neurostack
```

### 3. Deploy Services

```bash
# Apply Kubernetes manifests
kubectl apply -f infrastructure/kubernetes/

# Check deployments
kubectl get deployments -n neurostack
kubectl get pods -n neurostack

# View logs
kubectl logs -f deployment/api -n neurostack
```

### 4. Configure Ingress

```yaml
# infrastructure/kubernetes/ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: neurostack-ingress
spec:
  ingressClassName: nginx
  rules:
    - host: api.neurostack.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api-service
                port:
                  number: 8000
    - host: app.neurostack.io
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: web-service
                port:
                  number: 3000
```

## Infrastructure as Code (Terraform)

### AWS EKS Example

```hcl
# infrastructure/terraform/main.tf
provider "aws" {
  region = var.aws_region
}

# Create EKS cluster
resource "aws_eks_cluster" "neurostack" {
  name            = "neurostack"
  role_arn        = aws_iam_role.eks_cluster.arn
  vpc_config {
    subnet_ids = aws_subnet.private[*].id
  }
}

# Create node group
resource "aws_eks_node_group" "neurostack" {
  cluster_name    = aws_eks_cluster.neurostack.name
  node_group_name = "neurostack-nodes"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  scaling_config {
    desired_size = 3
    max_size     = 10
    min_size     = 1
  }
}

# RDS Database
resource "aws_db_instance" "neurostack" {
  allocated_storage    = 100
  engine              = "postgres"
  engine_version      = "15"
  instance_class      = "db.m6g.large"
  identifier          = "neurostack"
  username            = var.db_username
  password            = var.db_password
  publicly_accessible = false
  skip_final_snapshot = false
}

# ElastiCache for Redis
resource "aws_elasticache_cluster" "neurostack" {
  cluster_id           = "neurostack"
  engine              = "redis"
  node_type          = "cache.r6g.large"
  num_cache_nodes    = 3
  parameter_group_name = "default.redis7"
}
```

Deploy:
```bash
cd infrastructure/terraform
terraform init
terraform plan
terraform apply
```

## Database Setup

### PostgreSQL Initialization

```bash
# Connect to RDS instance
psql -h neurostack-db.us-east-1.rds.amazonaws.com \
     -U postgres \
     -d postgres

# Create database and users
CREATE DATABASE neurostack;
CREATE USER neurostack WITH PASSWORD 'secure-password';
GRANT ALL PRIVILEGES ON DATABASE neurostack TO neurostack;

# Apply migrations
psql -h neurostack-db.us-east-1.rds.amazonaws.com \
     -U neurostack \
     -d neurostack \
     -f infrastructure/migrations/001_init.sql
```

### ClickHouse Setup

```bash
# Create analytics database
clickhouse-client --host=clickhouse.aws.neurostack.io \
                  --user=default \
                  --password=password

# Create tables
CREATE TABLE neurostack.events (
  event_id UUID,
  tenant_id UUID,
  event_type String,
  timestamp DateTime,
  data JSON
) ENGINE = MergeTree()
ORDER BY (tenant_id, timestamp);
```

## Monitoring & Observability

### Prometheus Setup

```yaml
# infrastructure/kubernetes/prometheus.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
    scrape_configs:
      - job_name: 'neurostack'
        kubernetes_sd_configs:
          - role: pod
            namespaces:
              names:
                - neurostack
```

### Grafana Dashboards

Pre-configured dashboards:
- System health dashboard
- Query performance dashboard
- Agent observability dashboard
- Data quality dashboard

## SSL/TLS

### Certificate Management

```bash
# Using cert-manager with Let's Encrypt
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.13.0/cert-manager.yaml

# Create certificate
kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: neurostack-cert
spec:
  secretName: neurostack-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - api.neurostack.io
    - app.neurostack.io
EOF
```

## Scaling

### Horizontal Pod Autoscaling

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

## Backup & Recovery

### Database Backups

```bash
# Daily automated backups (AWS)
aws rds describe-db-instances --db-instance-identifier neurostack

# Manual backup
aws rds create-db-snapshot \
  --db-instance-identifier neurostack \
  --db-snapshot-identifier neurostack-backup-$(date +%Y%m%d)

# Restore from backup
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier neurostack-restored \
  --db-snapshot-identifier neurostack-backup-20240101
```

### Vector Database Backups

```bash
# Qdrant backup
curl -X POST http://qdrant:6333/snapshots

# Restore
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{"snapshot_name": "backup-20240101"}' \
  http://qdrant:6333/snapshots/recover
```

## Upgrade Process

### Blue-Green Deployment

```bash
# Deploy new version as "green"
kubectl set image deployment/api api=neurostack-api:v2.0.0

# Verify
kubectl rollout status deployment/api

# Rollback if needed
kubectl rollout undo deployment/api

# Complete switch when ready
# Update load balancer
```

### Canary Deployment

```yaml
# Gradually shift traffic to new version
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: api-canary
spec:
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api
  service:
    port: 8000
  analysis:
    interval: 1m
    threshold: 5
    metrics:
      - name: request-success-rate
        thresholdRange:
          min: 99
```

## Troubleshooting

### Deployment Issues

```bash
# Check pod status
kubectl describe pod <pod-name> -n neurostack

# View logs
kubectl logs <pod-name> -n neurostack

# Execute into pod
kubectl exec -it <pod-name> -n neurostack -- /bin/bash
```

### Database Connectivity

```bash
# Test connection from pod
kubectl run -it --rm debug --image=postgres:15 --restart=Never -- \
  psql -h postgres-service -U neurostack -d neurostack -c "SELECT 1"
```

### Performance Issues

```bash
# Check resource usage
kubectl top nodes
kubectl top pods -n neurostack

# Analyze metrics
# View Prometheus and Grafana dashboards
```

## Cost Optimization

- Use Reserved Instances (RDS, ElastiCache)
- Enable auto-scaling to avoid over-provisioning
- Use spot instances for non-critical workloads
- Implement proper monitoring to identify waste
- Consider managed services vs. self-hosted

## Support & Documentation

- Kubernetes docs: https://kubernetes.io/docs/
- Terraform docs: https://www.terraform.io/docs/
- AWS documentation: https://docs.aws.amazon.com/
- GCP documentation: https://cloud.google.com/docs

For NeuroStack-specific issues:
- GitHub Issues: https://github.com/ChaitanyaJoshi1769/NeuroStack/issues
- Documentation: See docs/ folder

# No replace, no go.work: inject infra into GOMODCACHE.
FROM golang:1.26-alpine AS builder
ENV GOMODCACHE=/go/pkg/mod
WORKDIR /app
COPY infra /go/pkg/mod/github.com/psds-microservice/infra@v0.0.3
COPY notification-service ./notification-service
WORKDIR /app/notification-service
RUN go mod download
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /notification-service ./cmd/notification-service

FROM alpine:3.19
RUN apk --no-cache add ca-certificates
WORKDIR /app
COPY --from=builder /notification-service .
EXPOSE 8092 8102
CMD ["./notification-service", "api"]

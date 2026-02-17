package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppHost  string
	HTTPPort string
	GRPCPort string
	AppEnv   string
	LogLevel string

	KafkaBrokers []string
	KafkaGroupID string
	KafkaTopics  []string

	DB struct {
		Host     string
		Port     string
		User     string
		Password string
		Database string
		SSLMode  string
	}

	WSReadBufferSize  int
	WSWriteBufferSize int
	WSSendQueueSize   int
}

func Load() (*Config, error) {
	_ = godotenv.Load(".env")
	_ = godotenv.Load("../.env")

	brokers := strings.TrimSpace(getEnv("KAFKA_BROKERS", "localhost:9092"))
	topics := getEnv("KAFKA_TOPICS", "psds.session.created,psds.session.ended,psds.session.operator_joined,psds.operator.assigned")
	var kafkaBrokers, kafkaTopics []string
	for _, s := range strings.Split(brokers, ",") {
		if t := strings.TrimSpace(s); t != "" {
			kafkaBrokers = append(kafkaBrokers, t)
		}
	}
	for _, s := range strings.Split(topics, ",") {
		if t := strings.TrimSpace(s); t != "" {
			kafkaTopics = append(kafkaTopics, t)
		}
	}

	readBuf, _ := strconv.Atoi(getEnv("WS_READ_BUFFER_SIZE", "4096"))
	writeBuf, _ := strconv.Atoi(getEnv("WS_WRITE_BUFFER_SIZE", "4096"))
	sendQueue, _ := strconv.Atoi(getEnv("WS_SEND_QUEUE_SIZE", "256"))
	if sendQueue <= 0 {
		sendQueue = 256
	}

	cfg := &Config{
		AppHost:           getEnv("APP_HOST", "0.0.0.0"),
		HTTPPort:          firstEnv("APP_PORT", "HTTP_PORT", "8092"),
		GRPCPort:          firstEnv("GRPC_PORT", "METRICS_PORT", "9092"),
		AppEnv:            getEnv("APP_ENV", "development"),
		LogLevel:          getEnv("LOG_LEVEL", "info"),
		KafkaBrokers:      kafkaBrokers,
		KafkaGroupID:      getEnv("KAFKA_GROUP_ID", "notification-service"),
		KafkaTopics:       kafkaTopics,
		WSReadBufferSize:  readBuf,
		WSWriteBufferSize: writeBuf,
		WSSendQueueSize:   sendQueue,
	}
	cfg.DB.Host = getEnv("DB_HOST", "localhost")
	cfg.DB.Port = getEnv("DB_PORT", "5432")
	cfg.DB.User = getEnv("DB_USER", "postgres")
	cfg.DB.Password = getEnv("DB_PASSWORD", "postgres")
	cfg.DB.Database = getEnv("DB_DATABASE", "notification_service")
	cfg.DB.SSLMode = getEnv("DB_SSLMODE", "disable")
	return cfg, nil
}

func (c *Config) Validate() error {
	if len(c.KafkaBrokers) == 0 && len(c.KafkaTopics) > 0 {
		return errors.New("config: KAFKA_BROKERS required when KAFKA_TOPICS set")
	}
	return nil
}

func (c *Config) DSN() string {
	return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		c.DB.Host, c.DB.Port, c.DB.User, c.DB.Password, c.DB.Database, c.DB.SSLMode)
}

func (c *Config) DatabaseURL() string {
	pass := url.QueryEscape(c.DB.Password)
	return fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
		c.DB.User, pass, c.DB.Host, c.DB.Port, c.DB.Database, c.DB.SSLMode)
}

func (c *Config) Addr() string {
	return c.AppHost + ":" + c.HTTPPort
}

func firstEnv(keysAndDef ...string) string {
	if len(keysAndDef) == 0 {
		return ""
	}
	def := keysAndDef[len(keysAndDef)-1]
	for _, k := range keysAndDef[:len(keysAndDef)-1] {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return def
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

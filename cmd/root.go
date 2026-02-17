package cmd

import (
	"github.com/spf13/cobra"
)

var rootCmd = &cobra.Command{
	Use:   "notification-service",
	Short: "Notification service: WebSocket events, Kafka consumer",
	RunE:  runAPI,
}

func Execute() error {
	return rootCmd.Execute()
}

func init() {
	rootCmd.AddCommand(apiCmd)
}

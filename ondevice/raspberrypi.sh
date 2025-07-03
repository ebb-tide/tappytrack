journalctl -u nfc.service -f # logging

sudo systemctl status nfc.service # check status
sudo systemctl start nfc.service 
sudo systemctl enable nfc.service
sudo systemctl daemon-reload # reload systemd to recognize the new service
sudo systemctl daemon-reexec 


/etc/systemd/system/nfc.service # file contents
[Unit]
Description=Start NFC Reader On Boot
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 /home/pi/nfc/run.py
WorkingDirectory=/home/pi/nfc
StandardOutput=inherit
StandardError=inherit
Restart=on-failure
RestartSec=10
User=pi
Environment= "PYTHONUNBUFFERED=1"

[Install]
WantedBy=multi-user.target
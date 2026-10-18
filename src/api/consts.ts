/**
 * Start of message. Every other byte of a message, the checksum included, is 7 bit, so SOM never appears inside one
 * and always marks the start of the next.
 */
export const SOM = 0xff

/**
 * The highest source or destination number the standard commands can address. Each is sent as DIV 128 in 3 bits of the
 * multiplier byte and MOD 128 in a byte of its own, which is 10 bits. Higher numbers need the extended commands.
 */
export const MAX_ADDRESS = 1024

/** Always leave at least 20 ms open between commands */
export const MESSAGE_GAP_MS = 20

/** How long to wait for any reply from the router before sending the next command anyway, when waiting for ACK */
export const ACK_TIMEOUT_MS = 1000

/** Half the router's default time out interval of 60 s */
export const KEEPALIVE_INTERVAL_MS = 30000

/** Matches TCPHelper's own default */
export const RECONNECT_INTERVAL_MS = 2000

/**
 * How long the line must be quiet to end a message whose length is not known and no SOM has followed. Without it, such
 * a message, the answer to the keepalive among them, would wait for the router's next message to end it.
 */
export const FRAME_IDLE_MS = 50

/** Queue priorities: a higher one is sent first, and messages of the same priority go in the order queued */
export enum Priority {
	/** Interrogates and keepalives. Interrogating a 1024 destination router takes 20 s or more */
	Background = 0,
	/** Anything a user is waiting on, so a button press doesn't wait behind an interrogation */
	Action = 1,
}

/** All commands referenced to Document SW-P-02 Issue 37, 07/09/17 */
export enum Command {
	/** This message is used to request a database checksum. ALSO This message responds with the checksum of a database after a DATABASE CHECKSUM REQUEST has been received. */
	DatabaseChecksum = 0x00,
	/** Request for tally information. A device responds to this message with a TALLY message 3.2.5. */
	Interrogate = 0x01,
	/** This message requests a route to be made through the router. A device will make the route and respond with a CONNECTED message (3.2.6) that also performs an effective acknowledgement. */
	Connect = 0x02,
	/** This message returns tally information in response to an interrogating device. It also performs an effective acknowledgement to the INTERROGATE message. */
	Tally = 0x03,
	/** This message is issued by a device after it has made a router through a router, usually in response to a CONNECT request. It is issued on ALL ports of the interface device. */
	Connected = 0x04,
	/** Used in Salvo switching situations. Routing information is held in the receiving device until activated by GO command (3.2.8). */
	ConnectOnGo = 0x05,
	/** Triggers the receiving device to set all routes in/clear the previously received CONNECT ON GO messages. A GO DONE acknowledge message (3.2.15), will be issued to indicate that the command has been executed. */
	Go = 0x06,
	/** Triggers the receiving device to respond with a status response message (3.2.10, 3.2.11, 3.2.12, 3.2.18 or 3.2.19). */
	StatusRequest = 0x07,
	/** Issued by a 2513/2514/2515/2659/2440 card or a TDM 4-Wire router (2510) card in response to the STATUS REQUEST message (3.2.9). */
	StatusResponse1 = 0x08,
	/** Issued by a 5007/5107 TDM controller card in response to the STATUS REQUEST message (3.2.9). */
	StatusResponse2 = 0x09,
	/** Issued by an HD local control card (2412/2413/2414) in response to the STATUS REQUEST message (3.2.9) */
	StatusResponse3 = 0x0a,
	/** Issued to a router to enable actual crosspoint setting to take place, otherwise the crosspoint card will store requests until enabled. Note: Currently only implemented in the HD local control card and this feature is jumper selectable. Also this command has no effect on HD Digital video/RS422 routers or MADI routers. */
	EnableCrosspointUpdate = 0x0b,
	/** This message is issued by a device in response to a CONNECT ON GO request (3.2.7). Only supported by 2413/4 HD LOCAL CONTROLLER, XD LOCAL CONTROLLER (2419) */
	ConnectOnGoAck = 0x0c,
	/** This message is issued by a device in response to a GO message, (3.2.8). If crosspoints are set then the message is issued on all ports of the receiving device. Only supported by 2413/4 HD LOCAL CONTROLLER, XD LOCAL CONTROLLER (2419) */
	GoDoneAck = 0x0d,
	/** Triggers the receiving device to respond with a SOURCE LOCK STATUS response message (3.2.17). This command is only applicable to the HD digital video routers. */
	SourceLockStatusRequest = 0x0e,
	/** Issued by an HD series local control card in response to the Source Lock Status request message (3.2.16). This message indicates the source lock status on the input modules. */
	SourceLockStatusResponse = 0x0f,
	/** This is sent in response to a STATUS REQUEST message (3.2.9). It indicates which modules in an XD router are faulty. */
	StatusResponse4 = 0x10,
	/** This is sent in response to a STATUS REQUEST message (3.2.9). It indicates which modules in a router made up of multiple routers are faulty. This message would normally be implemented on an interface unit which combines several router frames to make a logically larger router. */
	StatusResponse5 = 0x11,
	/** Triggers the receiving device to respond with a status response message 6 (3.2.21). */
	StatusRequest2 = 0x12,
	/** Issued by a controller card in response to the STATUS REQUEST 2 message (3.2.20). This message indicates that there are one or more types of these faults in the system. To find out more information about the faults use the command 07 (3.2.9) to request this. This message is broadcast on all ports whenever the fault status changes */
	StatusResponse6 = 0x13,
	/** The MIXER INTERROGATE message is sent by the control system to inquire about all sources contributing to the given output. The TDM 4-Wire Router controller (2510) will reply with MIXER TALLY DUMP (3.2.22). */
	MixerInterrogate = 0x15,
	/** This message is sent by the control system to the TDM 4-Wire Router to set a mixing crosspoint with the given gain coefficient. */
	MixerConnect = 0x16,
	/** This message is sent by a TDM 4-Wire Router in response to a MIXER INTERROGATE message. It returns information about all sources contributing to the given output. */
	MixerTallyDump = 0x17,
	/** This message confirms that crosspoint has been set following the MIXER CONNECT message. */
	MixerConnected = 0x18,
	/** This message allows the TDM 4-Wire Router to change assignment of physical inputs to time slots. It is indispensable for routers of size greater than 384 x 384. This message is also sent in response to a READ SLOT ASSIGNMENT message (3.2.25) by the TDM 4-Wire Router controller. */
	AssignSlot = 0x19,
	/** This message interrogates the TDM 4-Wire Router to find out which slot number is allocated to the given input. */
	ReadSlotAssignment = 0x1a,
	/** This message is sent to the TDM 4-Wire Router to change gain on the given output. This message is also sent in response to READ OUTPUT GAIN message (3.2.27). */
	SetOutputGain = 0x1b,
	/** This message is sent by the control system to read the gain coefficient applied on the given output of the TDM 4-Wire Router. */
	ReadOutputGain = 0x1c,
	/** This message is sent by the control system to read the input signal levels on all 96 ports of the TDM 4-Wire Router. */
	ReadTwinkler = 0x1d,
	/** This message is sent by the TDM 4-Wire Router in response to a READ TWINKLER command. */
	TwinklerStatus = 0x1e,
	/** This command requests the current configuration of installed crosspoint and I/O modules in a router. */
	InstalledModulesStatusRequest = 0x1f,
	/** This message is sent in response to the INSTALLED MODULES STATUS REQUEST. It indicates which cards were present when RECONFIGURE button was pressed last on router controller card. */
	InstalledModulesStatusResponse1 = 0x20,
	/** This message will be sent by a 4-Wire Router if a source has been replaced by the parking source on the given destination. */
	MixerDisconnected = 0x21,
	/** This message is sent in response to the INSTALLED MODULES STATUS REQUEST. It indicates which cards were present when RECONFIGURE button was pressed last on router controller card. */
	InstalledModulesStatusResponse3 = 0x22,
	/** Used in configuring up to 128 Salvos required for switching situations. Routing information is held in the receiving device until activated by GO GROUP SALVO command (3.2.35). */
	ConnectOnGoGroupSalvo = 0x23,
	/** Triggers the receiving device to set all routes in / clear the previously received CONNECT ON GO GROUP SALVO messages. A GO DONE GROUP SALVO acknowledge message (3.2.37) will be issued to indicate that the command has been executed. */
	GoGroupSalvo = 0x24,
	/** This message is issued by a device in response to a CONNECT ON GO GROUP SALVO request (3.2.34). */
	ConnectOnGoGroupSalvoAck = 0x25,
	/** This message is issued by a device in response to a GO GROUP SALVO message (3.2.35). */
	GoDoneGroupSalvoAck = 0x26,
	/** This is sent in response to the INSTALLED MODULES STATUS REQUEST. It indicates which cards were present when RECONFIGURE button was pressed last on XD router controller card. */
	InstalledModulesStatusResponse2 = 0x2a,
	/** This message requests the router input/output parameter data, the nature of which depends on the router type. The maximum number of sources that can be requested from any one request is restricted to 64. */
	RouterInputOutputParametersInterrogate = 0x2b,
	/** This message is issued in response to a ROUTER INPUT/OUTPUT PARAMETERS INTERROGATE message (3.2.39). The message data content depends on the router type selected */
	RouterInputOutputParametersTally = 0x2c,
	/** This message is issued to set input/output parameters for various router types. */
	RouterInputOutputParametersConnect = 0x2d,
	/** This message is issued in response to a ROUTER INPUT/OUTPUT PARAMETERS CONNECT message (3.2.41). The message is issued as confirmation of a successful ‘connect’. */
	RouterInputOutputParametersConnected = 0x2e,
	/** This message is issued to a dual router controller system to request the status of the controllers. */
	DualControllerStatusRequest = 0x32,
	/** This message is issued by the active controller on power-up or in response to a DUAL CONTROLLER STATUS REQUEST message (Command byte 50). */
	DualControllerStatusResponse = 0x33,
	/** This message requests tally information for devices with greater than 1024 sources and/or destinations. A device responds to this message with an Extended TALLY message (3.2.49). This message allows up to 16384 destinations to be addressed. */
	ExtendedInterrogate = 0x41,
	/** This message requests a route to be made through a router with greater than 1024 sources and/or destinations. If the device makes the route it will respond with an Extended CONNECTED message (3.2.50). This message allows up to 16384 sources and destinations to be controlled. */
	ExtendedConnect = 0x42,
	/** This message returns tally information in response to an interrogating device. It also performs an effective acknowledgement to the extended INTERROGATE command (3.2.47). */
	ExtendedTally = 0x43,
	/** This message is issued by a device after it has made a route through a router, usually in response to an Extended CONNECT request (3.2.48). It is issued on ALL ports of the interface device. */
	ExtendedConnected = 0x44,
	/** This is used in salvo switching situations. Routing information is held in the receiving device until activated by a GO command (3.2.8). A device will respond with an extended CONNECT ON GO ACKNOWLEDGE message (3.2.52) to indicate that the routing information has been stored successfully. This message allows up to 4096 sources and/or destinations to be controlled. */
	ExtendedConnectOnGo = 0x45,
	/** This message is issued by a device in response to an extended CONNECT ON GO message (3.2.51). */
	ExtendedConnectOnGoAck = 0x46,
	/** Used in configuring up to 128 Salvos required for switching situations. Routing information is held in the receiving device until activated by GO GROUP SALVO command (3.2.37). A device will respond with an Extended CONNECT ON GO GROUP SALVO ACKNOWLEDGE message (3.2.54) to indicate that the routing information has been stored successfully. */
	ExtendedConnectOnGoGroupSalvo = 0x47,
	/** This message is issued by a device in response to an extended CONNECT ON GO GROUP SALVO request (3.2.53). */
	ExtendedConnectOnGoGroupSalvoAck = 0x48,
	/** This is sent to request status data from the target system. A number of responses are possible depending on the target type. Multiple bits can be set in the status data type bit, to request more then 1 type of information in a single message. */
	StatusDataRequest = 0x49,
	/** This is sent in response to a STATUS DATA REQUEST message (Command byte 73). It contains status information pertaining to MADI Eclipse router. */
	StatusDataResponse1 = 0x4a,
	/** This is sent to request how the router is configured. The router responds with the ROUTER CONFIGURATION RESPONSE Message (Command byte 76). */
	RouterConfigurationRequest = 0x4b,
	/** This is sent in response to a ROUTER CONFIGURATION REQUEST message (Command byte 75). It contains a bit map showing which levels are configured and the number of destinations and sources on each level. When controlling a router with multiple levels the destinations are stacked on top of each other. */
	RouterConfigurationResponse1 = 0x4c,
	/** This is sent in response to a ROUTER CONFIGURATION REQUEST message (3.2.57). It contains a bit map showing which levels are configured and the number of destinations and sources on each level. When controlling a router with multiple levels the destinations are stacked on top of each other. */
	RouterConfigurationResponse2 = 0x4d,
	ProbelInternalUse1 = 0x52,
	ProbelInternalUse2 = 0x53,
	ProbelInternalUse3 = 0x54,
	ProbelInternalUse4 = 0x55,
	ProbelInternalUse5 = 0x56,
	BroadcastTech16x2Reserved1 = 0x5a,
	BroadcastTech16x2Reserved2 = 0x5b,
	BroadcastTech16x2Reserved3 = 0x5c,
	BroadcastTech16x2Reserved4 = 0x5d,
	BroadcastTech16x2Reserved5 = 0x5e,
	BroadcastTech16x2Reserved6 = 0x5f,
	/** This message is issued by a controller or a router in response to an EXTENDED PROTECT INTERROGATE message (Command Byte 101). It returns the current protect status of a destination. */
	ExtendedProtectTally = 0x60,
	/** This message is issued by either a controller or a router when the protect data is altered and also if the data was unsuccessfully altered as a result of an EXTENDED PROTECT CONNECT message (Command Bytes 102). This message is broadcast on all ports. */
	ExtendedProtectConnected = 0x61,
	/** This message is issued by a controller or a router when the protect data is altered, i.e. a destination has been unprotected and also if the data was unsuccessfully altered as a result of an EXTENDED PROTECT DIS-CONNECT message (Command Bytes 104). */
	ExtendedProtectDisconnected = 0x62,
	/** This message is issued by a controller or a Router in response to a PROTECT DEVICE NAME REQUEST message (Command Byte 103), returning the device name protecting a particular destination. */
	ProtectDeviceNameResponse = 0x63,
	/** This message is issued by a controller or a router in response to an EXTENDED PROTECT DUMP REQUEST (Command Byte 105). It returns all the Protect Information. */
	ExtendedProtectTallyDump = 0x64,
	/** This message is issued either by a controller or by a router to get the current protect status of a destination. The router will respond with an EXTENDED PROTECT TALLY message (Command Byte 96). */
	ExtendedProtectInterrogate = 0x65,
	/** This message is issued by a router or a remote device to protect a destination. The router will respond with an EXTENDED PROTECT CONNECTED message (Command Byte 97). */
	ExtendedProtectConnect = 0x66,
	/** Any device issues this message when the device name protecting a particular destination is required. */
	ProtectDeviceNameRequest = 0x67,
	/** This message is issued by a router or a remote device to remove protection from a destination. The controller or the router will issue an EXTENDED PROTECT DIS-CONNECTED message (Command Byte 98) in response. */
	ExtendedProtectDisconnect = 0x68,
	/** This message allows all the Protect information to be requested from a controller by a router when the router initialises. */
	ExtendedProtectTallyDumpRequest = 0x69,
	/** Triggers the receiving device to respond with Pre-Processing config response message (3.2.71). */
	PreprocessingConfigRequest = 0x6a,
	/** Issued by a Nucleus controller in response to the Pre-Processing config request message (3.2.70). This message indicates the controllers support for Pre-Processing input control. Pre-Processing allows inputs on an input card to be routed out on Pre-Processing outputs and Pre-Processing inputs to be routed in place of inputs on the card. */
	PreprocessingConfigResponse = 0x6b,
	/** Requests Pre-Processing tally information. The device responds with the Pre-Processing tally message (3.2.74). */
	PreprocessingInterrogate = 0x6c,
	/** This message sets / clears Pre-Processing routing. The device will make the route and respond with a Pre-Processing connected message (3.2.75). */
	PreprocessingConnect = 0x6d,
	/** This message returns Pre-Processing tally information in response to a Pre-Processing interrogate message (3.2.72). */
	PreprocessingTally = 0x6e,
	/** This message is issued by a device after it has made / cleared a Pre-Processing route usually in response to a Pre-Processing connect message (3.2.73). It is issued on ALL ports of the interface device. */
	PreprocessingConnected = 0x6f,
	/** This message is issued by a device in response to a command that cannot be executed. */
	CannotExecute = 0x78,
	/** This command byte selects one of the extended command set messages. It will be followed an extended command byte to select one of the extended messages. These are all defined in section 3.3. */
	ExtendedCommandSet = 0x7b,
	/** This message is sent by Charisma Ten X to an external device whenever the tally status inside the Charisma Ten X changes. */
	XTallyStatus = 0x7c,
	/** This message is sent by an external device to the Charisma Ten X to request a bitmap of the video and key sources that currently appear on the output of the Charisma Ten X, and, for the Ten X destination number mapping for each of video input. */
	XTallyInterrogate = 0x7d,
	/** This message is sent by an external device to the Charisma Ten X to acknowledge an X_TALLY_STATUS message previously sent by a Charisma Ten X. */
	XTallyStatusAck = 0x7e,
	/** This message is sent by Charisma Ten X in response to a X_TALLY_INTERROGATE request. */
	XTallyResponse = 0x7f,
}

/** The second byte of a {@link Command.ExtendedCommandSet} message */
export enum ExtendedCommand {
	/** Requests monitor row tally information. The device responds with the Monitor row tally message (3.3.3). */
	MonitorRowInterrogate = 0x00,
	/** This message sets a monitor row crosspoint. The device will make the route and respond with a Monitor row connected message (3.3.4). */
	MonitorRowConnect = 0x01,
	/** This message returns Monitor row tally information in response to a Monitor row interrogate message (3.3.1). */
	MonitorRowTally = 0x02,
	/** This message is issued by a device after it has set a monitor row route usually in response to a Monitor row connect message (3.3.2). It is issued on ALL ports of the interface device. */
	MonitorRowConnected = 0x03,
}

/** The parameter of a {@link Command.Go} message. The values are also saved against buttons using the Go action */
export enum GoMode {
	Set = 0x00,
	Clear = 0x01,
}

/** The parameter of a {@link Command.GoDoneAck} message */
export enum GoDoneResult {
	Set = 0x00,
	Clear = 0x01,
	/** No crosspoints were prepared */
	None = 0x02,
}

/** The parameter of a {@link Command.DatabaseChecksum} request */
export const DATABASE_CHECKSUM_REQUEST = 0x00

/** Byte 2 of a {@link Command.DualControllerStatusResponse} */
export enum IdleControllerStatus {
	Ok = 0x00,
	Faulty = 0x01,
	Unknown = 0x02,
}

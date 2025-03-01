import { SOM, cmd, cmdParam } from './consts.js'

export default function (self) {
	const optionDst = {
		type: 'dropdown',
		id: 'dst',
		label: 'Destination',
		choices: self.destinations,
		default: 1,
		allowCustom: true,
		tooltip: 'Variable must return an integer',
	}
	const optionSrc = {
		type: 'dropdown',
		id: 'src',
		label: 'Source',
		choices: self.sources,
		default: 1,
		allowCustom: true,
		tooltip: 'Variable must return an integer',
	}

	self.setActionDefinitions({
		connect: {
			name: 'Connect',
			description: 'Connect a crosspoint',
			options: [optionDst, optionSrc],
			callback: async ({ options }, context) => {
				let dst = parseInt(await context.parseVariablesInString(options.dst))
				let src = parseInt(await context.parseVariablesInString(options.src))
				if (isNaN(dst) || dst < 1 || dst > self.config.dst || isNaN(src) || src < 1 || src > self.config.src) {
					self.log('warn', `an invalid variable has been passed: dst: ${dst} src: ${src}`)
					return undefined
				}
				dst = self.calcDivMod(dst)
				src = self.calcDivMod(src)
				self.addCmdtoQueue([
					SOM,
					cmd.connect,
					dst[0] * 16 + src[0],
					dst[1],
					src[1],
					self.calcCheckSum([cmd.connect, dst[0] * 16 + src[0], dst[1], src[1]]),
				])
			},
			subscribe: async ({ options }, context) => {
				let dst = parseInt(await context.parseVariablesInString(options.dst))
				if (isNaN(dst) || dst < 0 || dst > self.config.dst) {
					self.log('warn', `an invalid variable has been passed: ${dst}`)
					return undefined
				} else if (dst === 0) {
					return
				}
				dst = self.calcDivMod(dst)
				let multiplier = dst[0] * 16
				self.addCmdtoQueue([
					SOM,
					cmd.interrogate,
					multiplier,
					dst[1],
					self.calcCheckSum([cmd.interrogate, multiplier, dst[1]]),
				])
			},
			learn: async (action, context) => {
				let dst = parseInt(await context.parseVariablesInString(action.options.dst))
				if (isNaN(dst) || dst < 0 || dst > self.config.dst) {
					self.log('warn', `an invalid variable has been passed: ${dst}`)
					return undefined
				} else if (dst === 0) {
					return
				}
				const source = self.connections[dst]
				dst = self.calcDivMod(dst)
				self.addCmdtoQueue([
					SOM,
					cmd.interrogate,
					dst[0] * 16,
					dst[1],
					self.calcCheckSum([cmd.interrogate, dst[0] * 16, dst[1]]),
				])
				return {
					...action.options,
					src: source,
				}
			},
		},
		interrogate: {
			name: 'Interrogate',
			description: 'Interrogate a destination',
			options: [optionDst],
			callback: async ({ options }, context) => {
				let dst = parseInt(await context.parseVariablesInString(options.dst))
				if (isNaN(dst) || dst < 0 || dst > self.config.dst) {
					self.log('warn', `an invalid variable has been passed: dst: ${dst}}`)
					return undefined
				} else if (dst === 0) {
					return
				}
				dst = self.calcDivMod(dst)
				self.addCmdtoQueue([
					SOM,
					cmd.interrogate,
					dst[0] * 16,
					dst[1],
					self.calcCheckSum([cmd.interrogate, dst[0] * 16, dst[1]]),
				])
			},
			subscribe: async ({ options }, context) => {
				let dst = parseInt(await context.parseVariablesInString(options.dst))
				if (isNaN(dst) || dst < 0 || dst > self.config.dst) {
					self.log('warn', `an invalid variable has been passed: ${dst}`)
					return undefined
				} else if (dst === 0) {
					return
				}
				dst = self.calcDivMod(dst)
				self.addCmdtoQueue([
					SOM,
					cmd.interrogate,
					dst[0] * 16,
					dst[1],
					self.calcCheckSum([cmd.interrogate, dst[0] * 16, dst[1]]),
				])
			},
		},
		connectOnGo: {
			name: 'Connect on Go',
			description: 'Prepare a crosspoint',
			options: [optionDst, optionSrc],
			callback: async ({ options }, context) => {
				let dst = parseInt(await context.parseVariablesInString(options.dst))
				let src = parseInt(await context.parseVariablesInString(options.src))
				if (isNaN(dst) || dst < 0 || dst > self.config.dst || isNaN(src) || src < 0 || src > self.config.src) {
					self.log('warn', `an invalid variable has been passed: dst: ${dst} src: ${src}`)
					return undefined
				} else if (dst === 0 || src === 0) {
					return
				}
				dst = self.calcDivMod(dst)
				src = self.calcDivMod(src)
				self.addCmdtoQueue([
					SOM,
					cmd.connectOnGo,
					dst[0] * 16 + src[0],
					dst[1],
					src[1],
					self.calcCheckSum([cmd.connectOnGo, dst[0] * 16 + src[0], dst[1], src[1]]),
				])
			},
		},
		goSetClear: {
			name: 'Go',
			description: 'Set or clear prepared crosspoints',
			options: [
				{
					type: 'dropdown',
					id: 'mode',
					label: 'Mode',
					choices: self.go_mode,
					default: cmdParam.go.set,
				},
			],
			callback: ({ options }) => {
				self.addCmdtoQueue([SOM, cmd.go, options.mode, self.calcCheckSum([cmd.go, options.mode])])
			},
		},
	})
}

import Discord from 'discord.js';
import Bot from './bot';
import PermissionModel from '../models/permission';
import Logger from './logger';
import { Config } from './types';
import ConfigTool from './configTool';
import Util from './util';
import GuildSettings from './guildSettings';

export default class CommandHandler {
    private bot: Bot;
    private config: Config;

    constructor(bot: Bot) {
        this.bot = bot;
        this.config = ConfigTool.getConfig();
    }

    private async gotPermission(member: Discord.GuildMember, cmd) {
        // Admin
        if (member.hasPermission(Discord.Permissions.FLAGS.ADMINISTRATOR)) {
            return true;
        }

        const userRoleIds = member.roles.cache.keyArray().map(strId => BigInt(strId));

        if (userRoleIds.length > 0) {
            // Check if one of the user roles got the required permission
            return await PermissionModel.guildRolesGotCommandPermission(BigInt(member.guild.id), cmd, ...userRoleIds);
        }

        return false;
    }

    private isCommandAvailable(message: Discord.Message, cmd: string) {
        const guild = this.bot.getGuild(message.guild.id);

        // Check if its a valid command
        const isValid = this.bot.doesCommandExist(cmd);

        if (!isValid) {
            return false;
        }

        cmd = this.bot.getCommand(cmd).cmd;

        // Check if guild disabled
        const isDisabled = guild.disabledCommands.includes(cmd);

        if (isDisabled) {
            return false;
        }

        // Make sure its the correct channel, only allow setup commands everywhere
        if (cmd === 'pickup') {
            return true;
        }
        if (guild.channels.has(BigInt(message.channel.id))) {
            if (this.bot.getCommand(cmd).global) {
                return true;
            } else if (guild.channels.get(BigInt(message.channel.id)) === 'pickup') {
                return true;
            } else {
                return false;
            }
        }

        return false;
    }

    private handleGuildCommandCooldown(message: Discord.Message, cmd: string, guildSettings: GuildSettings): boolean {
        const messageTimestamp = message.createdTimestamp;
        const command = this.bot.getCommand(cmd);
        const cmdCooldownTime = command.cooldown * 1000; // Given in seconds
        const cooldownTimes = guildSettings.commandCooldowns;
        const commandTime = cooldownTimes.get(command.cmd);

        if (commandTime) {
            if (commandTime + cmdCooldownTime > messageTimestamp) {
                const timeLeft = (commandTime + cmdCooldownTime) - messageTimestamp;
                message.channel.send(Util.formatMessage('info', `${message.author}, you can execute this command again in **${Util.formatTime(timeLeft)}**`));
                return false;
            }
        }
        cooldownTimes.set(command.cmd, messageTimestamp);

        return true;
    }

    private handleFloodProtection(message: Discord.Message, command: string, guildSettings: GuildSettings): boolean {
        const floodDelay = +this.config.settings.FLOOD_PROTECTION_DELAY;
        const floodMaxCommands = +this.config.settings.FLOOD_PROTECTION_MAX_COMMANDS;
        const floodTimeout = +this.config.settings.FLOOD_TIMEOUT_TIME;

        const commandExecutionsTimes = guildSettings.lastCommandExecutions;
        const lastUserCommandTimes = commandExecutionsTimes.get(message.member);
        const messageTimestamp = message.createdTimestamp;

        if (messageTimestamp) {
            if (!lastUserCommandTimes) {
                commandExecutionsTimes.set(message.member, { count: 1, timestamp: messageTimestamp });
                return true;
            } else {
                // If the message count already reached the max count, trigger flood protection without message
                if (lastUserCommandTimes.count >= floodMaxCommands) {
                    // Check if a flood reset is required
                    if ((lastUserCommandTimes.timestamp + floodTimeout) < messageTimestamp) {
                        lastUserCommandTimes.count = 1;
                        lastUserCommandTimes.timestamp = messageTimestamp;
                        return true;
                    }

                    return false;
                }

                // Reset the counter if last message is longer ago than flood timeout
                if ((lastUserCommandTimes.timestamp + floodTimeout) < messageTimestamp) {
                    lastUserCommandTimes.count = 1;
                }

                // Add to count if the message triggers the protection
                if ((lastUserCommandTimes.timestamp + floodDelay) > messageTimestamp) {
                    lastUserCommandTimes.count++;
                    lastUserCommandTimes.timestamp = messageTimestamp;
                }

                if (lastUserCommandTimes.count < floodMaxCommands) {
                    lastUserCommandTimes.timestamp = messageTimestamp;

                    return true;
                }

                // Don't display any message in case of the pickup command to avoid output in non bot managed channels
                if (command === 'pickup') {
                    return false;
                }

                message.channel.send(Util.formatMessage('error', `${message.author}, too quick, you got timed out for **${Util.formatTime(floodTimeout)}**`));
                return false;
            }
        }
    }

    async execute(message: Discord.Message, cmd: string, args: any[] = []) {
        const guildSettings = this.bot.getGuild(message.guild.id);

        const errorHandler = (err) => {
            // Insufficient permissions, in this case to send messages
            if (err.code === 50013) {
                // Nothing to do, ignore the exception
                return;
            }
            message.channel.send(Util.formatMessage('error', 'Something went wrong executing this command'));
            Logger.logError(`Error in executing '${cmd}' command, args: ${args.length ? args.join(', ') : '-'}`, err, false, message.guild.id, message.guild.name);
        }

        if (!this.isCommandAvailable(message, cmd)) {
            return;
        }

        if (!this.handleFloodProtection(message, cmd, guildSettings)) {
            return;
        }

        const guild = this.bot.getGuild(message.guild.id);
        const command = this.bot.getCommand(cmd)

        if (command.perms && !(await this.gotPermission(message.member, this.bot.getCommand(cmd).cmd))) {
            if (cmd === 'pickup') {
                // Don't display any message in case of the pickup command to avoid output in non bot managed channels
                return;
            }
            return message.channel.send(Util.formatMessage('error', `${message.author}, insufficient permissions to execute this command`));
        }

        // Test if required args are given
        const requiredArgs = command.args ? command.args.filter(arg => arg.required).length : 0;
        if (requiredArgs > args.length) {
            let reply = `${message.author}, arguments are missing, usage: ${guild.prefix}${command.cmd} `;
            command.args.forEach(arg => reply += `**${arg.name}** `);
            return message.channel.send(Util.formatMessage('info', reply));
        }

        if (!this.handleGuildCommandCooldown(message, cmd, guildSettings)) {
            return;
        }

        if (guild.commandSettings.has(command.cmd)) {
            try {
                await command.exec(this.bot, message, args, guild.commandSettings.get(command.cmd));
            } catch (err) { errorHandler(err) }
        } else {
            const defaults = command.defaults ? command.defaults.map(def => def.value) : null;

            if (defaults) {
                try {
                    await command.exec(this.bot, message, args, defaults);
                } catch (err) { errorHandler(err) }
            } else {
                try {
                    await command.exec(this.bot, message, args);
                } catch (err) { errorHandler(err) }
            }
        }
    }
}
import { Command } from '../core/types';
import Util from '../core/util';
import PickupModel from '../models/pickup';
import PlayerModel from '../models/player';
import PickupState from '../core/pickupState';

const command: Command = {
    cmd: 'add',
    category: 'pickup',
    aliases: ['+'],
    shortDesc: 'Add to one or multiple pickups',
    desc: 'Add to one or multiple pickups',
    args: [
        { name: '[pickup]...', desc: 'Name of the pickup', required: false }
    ],
    global: false,
    perms: false,
    exec: async (bot, message, params) => {
        // Trust check
        const guildSettings = bot.getGuild(message.guild.id);

        if (guildSettings.explicitTrust) {
            const alreadyTrusted = await PlayerModel.arePlayersTrusted(BigInt(message.guild.id), message.member.id);

            if (!alreadyTrusted.length) {
                const playedBefore = await PickupModel.playedBefore(BigInt(message.guild.id), BigInt(message.author.id));

                if (!playedBefore) {
                    return message.channel.send(Util.formatMessage('warn', `${message.author}, no previous pickup game found for you, you need to be trusted to add`));
                }
            }
        }

        if (guildSettings.trustTime) {
            const trustTime = guildSettings.trustTime;
            const joinDate = message.member.joinedAt;
            const timeLeft = (joinDate.getTime() + trustTime) - new Date().getTime();
            if (timeLeft > 0) {
                // Check if already trusted
                const alreadyTrusted = await PlayerModel.arePlayersTrusted(BigInt(message.guild.id), message.member.id);

                if (alreadyTrusted.length === 0) {
                    return message.channel.send(Util.formatMessage('warn', `${message.author}, you joined this server recently, please wait ${Util.formatTime(Math.abs(timeLeft))}`));
                }
            }
        }

        // Ban check
        const isBanned = await PlayerModel.isPlayerBanned(BigInt(message.guild.id), BigInt(message.member.id));
        if (isBanned) {
            if (isBanned.ends_at) {
                const timeDif = isBanned.ends_at.getTime() - new Date().getTime();
                return message.channel.send(Util.formatMessage('error', `${message.author}, you are banned, time left: ${Util.formatTime(timeDif)} ${isBanned.reason ? ', reason: ' + isBanned.reason : ''}`));
            } else {
                return message.channel.send(Util.formatMessage('error', `${message.author}, you are permbanned${isBanned.reason ? ', reason: ' + isBanned.reason : ''}`));
            }
        }

        const roleCheck = async (...pickupIds) => {
            const userRoles = message.member.roles.cache;
            const invalidPickups = [];

            for (const id of pickupIds) {
                const pickupSettings = await PickupModel.getPickupSettings(BigInt(message.guild.id), id);
                const guildSettings = bot.getGuild(message.guild.id);

                // Pickup settings
                if (pickupSettings.allowlistRole) {
                    if (!userRoles.has(pickupSettings.allowlistRole.toString())) {
                        invalidPickups.push(id);
                        continue;
                    }
                } else if (pickupSettings.denylistRole) {
                    if (userRoles.has(pickupSettings.denylistRole.toString())) {
                        invalidPickups.push(id);
                        continue;
                    }
                }

                // Guild defaults
                if (guildSettings.allowlistRole) {
                    if (!userRoles.has(guildSettings.allowlistRole.toString())) {
                        invalidPickups.push(id);
                        continue;
                    }
                } else if (guildSettings.denylistRole) {
                    if (userRoles.has(guildSettings.denylistRole.toString())) {
                        invalidPickups.push(id);
                    }
                }
            }

            return invalidPickups;
        }

        // Don't allow to add when the player is added to a pickup in manual picking stage
        const isInPickingStage = await PickupModel.isPlayerAddedToPendingPickup(BigInt(message.guild.id), BigInt(message.member.id), 'picking_manual', 'mapvote', 'captain_selection');

        if (isInPickingStage) {
            return message.channel.send(Util.formatMessage('error', `${message.author}, you are not allowed to add to pickups when added to a pickup in pending stage`));
        }

        if (params.length === 0) {
            if (!await PickupModel.getStoredPickupCount(BigInt(message.guild.id))) {
                return;
            }

            const playerAddedTo = await PickupModel.isPlayerAdded(BigInt(message.guild.id), BigInt(message.member.id));
            const activeAndDefaultPickups = Array.from(await (await PickupModel.getActivePickups(BigInt(message.guild.id), true)).values());

            let validPickups = activeAndDefaultPickups
                .filter(pickup => !(playerAddedTo.includes(pickup.configId) || pickup.maxPlayers <= 2 || pickup.players.length === pickup.maxPlayers)) // Only autoadd on 2+ player pickups
                .map(pickup => pickup.configId);

            if (validPickups.length === 0) {
                return;
            }

            const invalidPickups = await roleCheck(...validPickups);
            validPickups = validPickups.filter(id => !invalidPickups.includes(id));

            if (invalidPickups.length) {
                const invalidPickupNames = [...activeAndDefaultPickups].filter(pickup => invalidPickups.includes(pickup.configId))
                    .map(pickup => pickup.name);

                message.channel.send(Util.formatMessage('error', `${message.author}, you are not allowed to add to ${invalidPickupNames.join(', ')} (Allowlist / Denylist)`));
            }

            if (validPickups.length === 0) {
                return;
            }

            await PlayerModel.storeOrUpdatePlayer(BigInt(message.guild.id), BigInt(message.member.id), message.member.displayName);
            await PickupState.addPlayer(message.member, ...validPickups);
        } else {
            const existingPickups = await PickupModel.areValidPickups(BigInt(message.guild.id), true, ...params);

            if (existingPickups.length === 0) {
                return;
            }

            const activeAndDefaultPickups = Array.from(await (await PickupModel.getActivePickups(BigInt(message.guild.id), true)).values());

            let validPickups = existingPickups.filter(pickup => {
                const activePickup = activeAndDefaultPickups.find(pu => pu.configId === pickup.id);

                if (activePickup) {
                    // Already added to the pickup
                    if (activePickup.players.map(player => player.id).includes(message.author.id)) {
                        return false;
                    }

                    // Pickup is full and in pending state
                    if (activePickup.maxPlayers === activePickup.players.length) {
                        return false;
                    }
                }
                return true;
            });

            if (validPickups.length === 0) {
                return;
            }

            const invalidPickups = await roleCheck(...validPickups.map(pickup => pickup.id));

            if (invalidPickups.length) {
                const invalidPickupNames = validPickups.filter(pickup => invalidPickups.includes(pickup.id))
                    .map(pickup => pickup.name);

                message.channel.send(Util.formatMessage('error', `${message.author}, you are not allowed to add to ${invalidPickupNames.join(', ')} (Allowlist / Denylist)`));
            }

            validPickups = validPickups.filter(pickup => !invalidPickups.includes(pickup.id));

            if (validPickups.length === 0) {
                return;
            }

            await PlayerModel.storeOrUpdatePlayer(BigInt(message.guild.id), BigInt(message.member.id), message.member.displayName);
            await PickupState.addPlayer(message.member, ...validPickups.map(pickup => pickup.id))
        }
    }
};

module.exports = command;
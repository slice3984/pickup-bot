import { Command } from '../core/types';
import PlayerModel from '../models/player';
import Util from '../core/util';

const command: Command = {
    cmd: 'ao',
    category: 'pickup',
    shortDesc: 'Enables / disables or shows the status of your allow offline',
    desc: 'Enables / disables or shows the status of your allow offline, ao prevents removal on offline status',
    args: [
        { name: '[show]', desc: 'call with show to show how much time is left until your ao expires', required: false }
    ],
    defaults: [
        { type: 'time', name: 'max-duration', desc: 'Duration of the allow offline', value: 21600000, possibleValues: { from: 3600000, to: 86400000 } }
    ],
    global: false,
    perms: false,
    exec: async (bot, message, params, defaults) => {
        if (params.length === 0) {
            const ao = await PlayerModel.getAos(BigInt(message.guild.id), message.member.id);

            if (!ao) {
                await PlayerModel.setAo(BigInt(message.guild.id), BigInt(message.member.id), defaults[0]);
                return message.channel.send(Util.formatMessage('success', `${message.author}, ao enabled, you will have offline immunity for ${Util.formatTime(defaults[0])}`));
            } else {
                await PlayerModel.removeAos(BigInt(message.guild.id), message.member.id);
                return message.channel.send(Util.formatMessage('success', `${message.author}, your ao got removed`));
            }
        }

        if (params[0] === 'show') {
            const ao = await PlayerModel.getAos(BigInt(message.guild.id), message.member.id);

            if (!ao) {
                return message.channel.send(Util.formatMessage('info', `${message.author}, you got no active ao`));
            }

            const timeLeft = ao[0].ao_expire.getTime() - new Date().getTime();
            message.channel.send(Util.formatMessage('info', `${message.author}, your ao will expire in ${Util.formatTime(timeLeft)}`));
        }
    }
}

module.exports = command;
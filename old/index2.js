// index2.js
import puppeteer from 'puppeteer';
import config from './config.js'; // Assurez-vous d'inclure l'extension .js
// Helper function to pause execution for a given number of milliseconds
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
  // Lancement du navigateur en mode non-headless pour débogage (passer à true en production)
  const browser = await puppeteer.launch({ headless: true, defaultViewport: null });
  const page = await browser.newPage();

  try {
    // -------------------------------------------------------
    // 1. AUTHENTIFICATION
    // -------------------------------------------------------

    // 1.1 Accéder à la page de connexion
    await page.goto(config.loginUrl, { waitUntil: 'networkidle2' });

    // 1.2 Remplir le champ email
    await page.waitForSelector('.wrap-input100.validate-input.form_connexion_input.step-1_co.show-partner input[name="email"]');
    await page.type(
      '.wrap-input100.validate-input.form_connexion_input.step-1_co.show-partner input[name="email"]',
      config.username
    );
    await sleep(500); // Alternative à waitForTimeout

    // 1.3 Cliquer sur le bouton "Connexion / Inscription"
    await page.waitForSelector('button.contact100-form-btn');
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button.contact100-form-btn'))
        .find(el => el.textContent.trim().includes('Connexion / Inscription'));
      if (btn) btn.click();
    });
    await sleep(1000); // Alternative à waitForTimeout

    // 1.4 Remplir le champ du mot de passe
    await page.waitForSelector('.wrap-input100.validate-input.form_connexion_input.password_input.step-2_co.show-partner input[name="pass"]');
    await page.type(
      '.wrap-input100.validate-input.form_connexion_input.password_input.step-2_co.show-partner input[name="pass"]',
      config.password
    );
    await sleep(500); // Alternative à waitForTimeout

    // 1.5 Cliquer sur le bouton "Se connecter"
    await page.waitForSelector('button.contact100-form-btn.step-2_co.show-partner');
    await page.evaluate(() => {
      const btn = document.querySelector('button.contact100-form-btn.step-2_co.show-partner');
      if (btn) {
        const event = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        btn.dispatchEvent(event);
      }
    });
    await sleep(3000); // Alternative à waitForTimeout

    console.log("Processus d'authentification terminé.");

    // -------------------------------------------------------
    // 2. ACCÈS À LA PAGE DE RÉSERVATION
    // -------------------------------------------------------
    await page.goto(config.memberUrl, { waitUntil: 'networkidle2' });
    await page.waitForSelector('a[href="reservation.html"]');
    await page.click('a[href="reservation.html"]');
    await page.waitForSelector('div.input-wrapper input#date');
    
    // -------------------------------------------------------
    // 3. SÉLECTION DE LA DATE (J+7)
    // -------------------------------------------------------
    const formattedDate = await page.evaluate(() => {
      const today = new Date();
      const targetDate = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const dd = ("0" + targetDate.getDate()).slice(-2);
      const mm = ("0" + (targetDate.getMonth() + 1)).slice(-2);
      const yyyy = targetDate.getFullYear();
      const formatted = dd + '/' + mm + '/' + yyyy;
      // Affecter la valeur dans le champ date (même s'il est readonly)
      const dateInput = document.getElementById('date');
      dateInput.value = formatted;
      // Déclencher l'événement change
      const event = new Event('change', { bubbles: true });
      dateInput.dispatchEvent(event);
      return formatted;
    });
    console.log("Date sélectionnée (j+7) :", formattedDate);
    await sleep(1000); // Alternative à waitForTimeout

    // -------------------------------------------------------
    // 4. SÉLECTION DE L'HORAIRE (priorité : 14:00, 14:30, 15:00, 15:30, 16:00)
    // -------------------------------------------------------
    await page.waitForSelector('select#heure');
    const selectedHour = await page.evaluate((hourPreferences) => {
      const select = document.getElementById('heure');
      let chosen = null;
      for (let pref of hourPreferences) {
        const option = select.querySelector(`option[value="${pref}"]`);
        if (option && !option.disabled) {
          select.value = pref;
          // Déclencher l'événement change
          const event = new Event('change', { bubbles: true });
          select.dispatchEvent(event);
          chosen = pref;
          break;
        }
      }
      // Si aucun horaire préféré n'est disponible, ne rien sélectionner
      return chosen;
    }, config.hourPreferences);
    if (!selectedHour) {
      throw new Error("Aucun créneau horaire disponible parmi les horaires préférés : " + config.hourPreferences.join(", "));
    }
    console.log("Créneau horaire sélectionné (préféré) :", selectedHour);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Alternative à waitForTimeout

    // Attendre plus longtemps pour assurer le chargement des terrains
    console.log("Attente du chargement des terrains disponibles...");
    await sleep(3000); // Attendre 3 secondes pour le chargement complet

    // -------------------------------------------------------
    // 5. SÉLECTION DU TERRAIN (en fonction des préférences)
    // -------------------------------------------------------
    console.log(`Mode de sélection: ${config.useCourtPreferences ? 'Avec préférences de terrain' : 'Préférences d\'horaire uniquement'}`);

    const terrainInfo = await page.evaluate((params) => {
      const { useCourtPreferences, courtPreferences, hourPreferences } = params;
      
      // Structure pour stocker tous les terrains disponibles
      const availableCourts = [];
      
      // Récupérer tous les blocs de terrain
      const courtBlocks = document.querySelectorAll('.bloccourt');
      console.log(`Nombre de blocs de terrains trouvés: ${courtBlocks.length}`);
      
      // Parcourir tous les terrains et extraire les informations
      courtBlocks.forEach((court) => {
        const courtId = court.getAttribute('data-idcourt');
        if (!courtId) return;
        
        const buttons = court.querySelectorAll('.blocCourt_container_btn-creneau button.btn_creneau:not([disabled])');
        buttons.forEach(btn => {
          const hour = btn.textContent.trim();
          
          // Calculer les scores de priorité
          const courtScore = useCourtPreferences 
            ? (courtPreferences.indexOf(courtId) !== -1 ? courtPreferences.indexOf(courtId) : 999) 
            : 0; // Si pas de préférence de terrain, tous les terrains ont le même score
          
          const hourScore = hourPreferences.indexOf(hour) !== -1 
            ? hourPreferences.indexOf(hour) 
            : 999;
          
          availableCourts.push({
            courtId: courtId,
            hour: hour,
            button: btn,
            courtScore: courtScore,
            hourScore: hourScore
          });
          
          console.log(`Terrain ${courtId} disponible à ${hour} (score terrain: ${courtScore}, score heure: ${hourScore})`);
        });
      });
      
      console.log(`Total des options disponibles: ${availableCourts.length}`);
      
      if (availableCourts.length === 0) {
        return null;
      }
      
      // Trier en fonction du mode de sélection
      if (useCourtPreferences) {
        // Si préférence de terrain activée: d'abord trier par terrain, puis par heure
        availableCourts.sort((a, b) => {
          if (a.courtScore !== b.courtScore) {
            return a.courtScore - b.courtScore;
          }
          return a.hourScore - b.hourScore;
        });
        console.log("Tri effectué par priorité de terrain puis d'horaire");
      } else {
        // Sinon: trier uniquement par préférence d'heure
        availableCourts.sort((a, b) => a.hourScore - b.hourScore);
        console.log("Tri effectué uniquement par priorité d'horaire");
      }
      
      // Afficher le meilleur choix trouvé
      const best = availableCourts[0];
      if (best) {
        console.log(`Meilleur choix trouvé: Terrain ${best.courtId} à ${best.hour}`);
        best.button.click();
        return {
          courtId: best.courtId, 
          hour: best.hour
        };
      }
      
      return null;
    }, {
      useCourtPreferences: config.useCourtPreferences,
      courtPreferences: config.courts.preferences,
      hourPreferences: config.hourPreferences
    });

    if (!terrainInfo) {
      throw new Error("Aucun terrain disponible pour les créneaux préférés.");
    }

    // Afficher le terrain sélectionné avec son nom s'il est connu
    const courtName = config.courts[terrainInfo.courtId] || 'Inconnu';
    console.log(`Terrain sélectionné: ${terrainInfo.courtId} (${courtName}) à ${terrainInfo.hour}`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // -------------------------------------------------------
    // 6. RENSEIGNEMENT AUTOMATIQUE DES INFORMATIONS DES PARTENAIRES
    // -------------------------------------------------------
    console.log("Début de la sélection des partenaires...");

    // Étape préliminaire: extraire l'ID de terrain courant
    const courtId = await page.evaluate(() => {
      const activeTerrainElement = document.querySelector('.bloccourt.active');
      return activeTerrainElement ? activeTerrainElement.getAttribute('data-idcourt') : '2164';
    });
    console.log(`ID du terrain actif: ${courtId}`);

    // Définir les informations des partenaires
    const partners = [
      { position: 0, playerId: "148146", playerName: "Joueur INVITE1" },
      { position: 1, playerId: "148147", playerName: "Joueur INVITE2" },
      { position: 2, playerId: "148148", playerName: "Joueur INVITE3" }
    ];

    // Traiter chaque partenaire séquentiellement avec des délais appropriés
    for (const partner of partners) {
      try {
        console.log(`Sélection du partenaire ${partner.position + 1}: ${partner.playerName}`);
        
        // 1. Attendre et cliquer sur l'image du joueur (PNG) pour ouvrir la modale
        const playerImgSelector = `div#ref_${courtId}_${partner.position} img.openmodalpartenaires`;
        await page.waitForSelector(playerImgSelector, { timeout: 5000 });
        console.log(`Image du joueur ${partner.position + 1} trouvée, clic pour ouvrir la modale...`);
        
        // Clic plus direct sur l'image PNG du joueur
        await page.evaluate((selector) => {
          const img = document.querySelector(selector);
          if (img) img.click();
        }, playerImgSelector);
        
        // 2. Attendre que la modale apparaisse complètement
        await page.waitForSelector('.modal#modalpartenaires.show', { timeout: 5000 });
        console.log(`Modale de sélection ouverte pour le joueur ${partner.position + 1}`);
        await sleep(500); // Attendre que la modale soit stable
        
        // 3. Cliquer précisément sur l'image PNG du partenaire souhaité dans la modale
        const partnerImgSelector = `span.choose_partner_js[data-idplayer="${partner.playerId}"] img`;
        await page.waitForSelector(partnerImgSelector, { timeout: 5000 });
        console.log(`Image du partenaire ${partner.playerName} trouvée, clic en cours...`);
        
        // Utiliser un clic direct sur l'image PNG pour sélectionner le partenaire
        await page.evaluate((selector) => {
          const img = document.querySelector(selector);
          if (img) {
            // Clic sur l'image, pas sur le conteneur
            img.click();
          }
        }, partnerImgSelector);
        
        // 4. Attendre que la modale se ferme complètement
        await page.waitForFunction(() => {
          return !document.querySelector('.modal#modalpartenaires.show');
        }, { timeout: 5000 });
        console.log(`Modale fermée après sélection du partenaire ${partner.playerName}`);
        
        // 5. Attendre un moment pour que les changements soient appliqués
        await sleep(1000);
        
        // 6. Vérifier que le partenaire a bien été sélectionné après la fermeture de la modale
        const isSelected = await page.evaluate((courtId, position, expectedId) => {
          const playerSlot = document.querySelector(`div#ref_${courtId}_${position}`);
          if (!playerSlot) return false;
          const currentId = playerSlot.getAttribute('data-idplayer');
          return currentId === expectedId;
        }, courtId, partner.position, partner.playerId);
        
        // console.log(`Vérification de la sélection: ${isSelected ? 'Réussie ✓' : 'Échouée ✗'`);
        
        // Si la sélection a échoué, essayer la méthode de contournement
        if (!isSelected) {
          console.log(`La sélection via modale a échoué pour ${partner.playerName}, tentative de contournement...`);
          
          await page.evaluate((courtId, position, playerId, playerName) => {
            const slotElem = document.getElementById(`ref_${courtId}_${position}`);
            if (slotElem) {
              // Modifier directement les attributs
              slotElem.setAttribute("data-idplayer", playerId);
              
              // Modifier l'apparence
              const imgElem = slotElem.querySelector("img.openmodalpartenaires");
              if (imgElem) {
                imgElem.setAttribute("data-idplayer", playerId);
                imgElem.src = "/img/avatars/avatar_homme.png"; // Changer l'image
              }
              
              // Modifier le texte
              const pElem = slotElem.querySelector("p.insertInfosPartners");
              if (pElem) {
                pElem.textContent = playerName;
              }
              
              // Cacher le spinner si présent
              const spinner = slotElem.querySelector(".spinner-border");
              if (spinner) {
                spinner.style.display = "none";
              }
            }
          }, courtId, partner.position, partner.playerId, partner.playerName);
        }
        
      } catch (error) {
        console.error(`Erreur lors de la sélection du partenaire ${partner.position + 1}:`, error.message);
        
        // Tentative de récupération en dernier recours
        console.log("Tentative de contournement...");
        await page.evaluate((courtId, position, playerId, playerName) => {
          const slotElem = document.getElementById(`ref_${courtId}_${position}`);
          if (slotElem) {
            // Injection directe du HTML pour contourner le problème
            slotElem.setAttribute("data-idplayer", playerId);
            slotElem.innerHTML = `
              <img data-toggle="modal" data-idplayer="${playerId}" data-idcourt="${courtId}" 
                   data-target="#modalpartenaires" class="openmodalpartenaires imaged w48 rounded" 
                   src="/img/avatars/avatar_homme.png" alt="image">
              <p class="mt-1 d-flex flex-column insertInfosPartners">${playerName}</p>`;
          }
        }, courtId, partner.position, partner.playerId, partner.playerName);
      }
      
      // Attendre entre chaque partenaire pour éviter les problèmes
      await sleep(1500);
    }

    console.log("Informations des partenaires renseignées.");
    await new Promise(resolve => setTimeout(resolve, 1000)); // Pause avant de passer à la réservation

    // -------------------------------------------------------
    // 7. CLIC SUR LE BOUTON "RÉSERVER"
    // -------------------------------------------------------
    console.log("Préparation du clic sur le bouton 'Réserver'...");

    // Attendre que le bouton soit disponible avec une attente plus longue
    await page.waitForSelector('button.buttonaddresa', { timeout: 10000 });
    console.log("Bouton 'Réserver' trouvé dans le DOM");

    // Attendre un peu pour s'assurer que le bouton est réellement actif
    await sleep(2000);

    // Approche simple et directe pour cliquer sur le bouton
    try {
      // Essayer d'abord un clic standard via Puppeteer
      console.log("Tentative de clic direct sur le bouton 'Réserver'...");
      await page.click('button.buttonaddresa');
      console.log("Clic sur 'Réserver' effectué par méthode standard");
    } catch (clickError) {
      console.log("Méthode de clic standard a échoué, tentative alternative...", clickError.message);
      
      // Si le clic standard échoue, forcer le clic via JavaScript
      await page.evaluate(() => {
        const button = document.querySelector('button.buttonaddresa');
        if (button) {
          console.log("Exécution du clic via JavaScript...");
          button.click();
        } else {
          throw new Error("Bouton 'Réserver' introuvable dans le DOM");
        }
      });
      console.log("Clic sur 'Réserver' effectué par méthode alternative");
    }

    console.log("Attente de l'affichage de la modale...");

    // -------------------------------------------------------
    // 8. DANS LA MODALE, CLIC SUR "PAYER SUR PLACE"
    // -------------------------------------------------------

    // Attendre que la modale apparaisse avec une tolérance plus grande
    try {
      await page.waitForSelector('.modal#choix_paiement.show', { timeout: 10000 });
      console.log("Modale de paiement affichée");
    } catch (modalError) {
      console.log("Attente de la modale a échoué, tentative de récupération...", modalError.message);
      
      // Si la modale n'apparaît pas, vérifier si le bouton est toujours là et réessayer
      const buttonStillExists = await page.evaluate(() => {
        return !!document.querySelector('button.buttonaddresa');
      });
      
      if (buttonStillExists) {
        console.log("Bouton 'Réserver' toujours présent, nouvelle tentative de clic...");
        await page.evaluate(() => {
          const button = document.querySelector('button.buttonaddresa');
          if (button) button.click();
        });
        
        // Attendre à nouveau la modale
        await page.waitForSelector('.modal#choix_paiement.show', { timeout: 10000 });
        console.log("Modale de paiement affichée après seconde tentative");
      } else {
        console.log("Bouton 'Réserver' non trouvé pour seconde tentative");
      }
    }

    // Observer le montant total affiché
    const totalAmount = await page.evaluate(() => {
      const totalElement = document.querySelector('.choix_paiement_total #total_resa');
      return totalElement ? totalElement.textContent.trim() : "Montant inconnu";
    });
    console.log(`Montant total de la réservation: ${totalAmount}`);

    // Attendre que le bouton "Payer sur place" soit visible
    await page.waitForSelector('a.btn.btn-text-primary.btn-block.addresa[data-dismiss="modal"]');
    console.log("Bouton 'Payer sur place' trouvé, clic en cours...");

    // Clic sur "Payer sur place" en utilisant directement la méthode click() de Puppeteer
    try {
      await page.click('a.btn.btn-text-primary.btn-block.addresa[data-dismiss="modal"]');
      console.log("Clic sur 'Payer sur place' effectué");
    } catch (payClickError) {
      console.log("Méthode de clic standard a échoué pour 'Payer sur place', tentative alternative...");
      
      // Si le clic standard échoue, forcer le clic via JavaScript
      await page.evaluate(() => {
        const payButton = document.querySelector('a.btn.btn-text-primary.btn-block.addresa[data-dismiss="modal"]');
        if (payButton) payButton.click();
      });
      console.log("Clic sur 'Payer sur place' effectué par méthode alternative");
    }

    // Attendre que la modale se ferme
    await page.waitForFunction(() => {
      return !document.querySelector('.modal#choix_paiement.show');
    }, { timeout: 5000 });

    console.log("Paiement sur place confirmé, modale fermée.");

    // Attendre un moment pour que le système enregistre la réservation
    await sleep(3000);

    // Vérifier la confirmation finale de la réservation
    const isReservationConfirmed = await page.evaluate(() => {
      // Rechercher une indication de confirmation sur la page
      const successMessage = document.querySelector('.alert-success') || 
                              document.querySelector('[data-success="true"]') ||
                              Array.from(document.querySelectorAll('div')).find(el => 
                                el.textContent.includes('Réservation confirmée') || 
                                el.textContent.includes('réservation réussie'));
      
      return !!successMessage;
    });

    if (isReservationConfirmed) {
      console.log("✅ Réservation confirmée avec succès!");
    } else {
      console.log("⚠️ Pas de confirmation de réservation explicite trouvée, mais le processus semble terminé.");
    }

    console.log("Processus de réservation terminé avec succès.");
  } catch (err) {
    console.error("Erreur durant le processus :", err);
  } finally {
    await browser.close();
  }
})();


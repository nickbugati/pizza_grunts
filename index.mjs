import Alexa from 'ask-sdk-core';
import { Order, Customer, Item, Payment, NearbyStores, Tracking, Menu } from 'dominos';
import AWS from 'aws-sdk';

// Create a Secrets Manager client
const secretsManager = new AWS.SecretsManager();

async function getSecret(secretName) {
    return new Promise((resolve, reject) => {
        secretsManager.getSecretValue({ SecretId: secretName }, (err, data) => {
            if (err) {
                reject(err);
            } else {
                // Secrets are returned as a stringified JSON. Parse them.
                resolve(JSON.parse(data.SecretString));
            }
        });
    });
}

async function findNearestStore(address) {
    const nearbyStores = await new NearbyStores(address);
    let storeID = 0;
    let distance = 100;

    for (const store of nearbyStores.stores) {
        if (store.IsOnlineCapable
            && store.IsDeliveryStore
            && store.IsOpen
            && store.ServiceIsOpen.Delivery
            && store.MinDistance < distance) {
            distance = store.MinDistance;
            storeID = store.StoreID;
        }
    }

    if (storeID == 0) {
        throw ReferenceError('No Open Stores');
    }
    return storeID;
}

async function createOrder(customer, pizza, storeID) {
    const order = new Order(customer);
    order.storeID = storeID;
    order.addItem(pizza);
    await order.validate();
    await order.price();
    return order;
}

const LaunchRequestHandler = {
    async canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        const dryMode = process.env.DRY_MODE !== 'false';

        try {
            const secrets = await getSecret('dominosOrdering');
            const address = secrets.ADDRESS;
            const cardDetails = {
                number: secrets.CARD_NUMBER,
                expiration: secrets.CARD_EXPIRATION,
                securityCode: secrets.CARD_SECURITY_CODE,
                postalCode: secrets.CARD_POSTAL_CODE
            };

            //Cheese Pizza
            const pizza=new Item(
                {
                    code:'14SCREEN'
                }
            );

            const customer = new Customer({
                address: address,
                firstName: secrets.FIRST_NAME,
                lastName: secrets.LAST_NAME,
                phone: secrets.PHONE,
                email: secrets.EMAIL
            });

            const storeID = await findNearestStore(address);

            // Get the menu for the found store
            const menu = await new Menu(storeID);

            const order = await createOrder(customer, pizza, storeID);

            const myCard = new Payment({
                amount: order.amountsBreakdown.customer,
                ...cardDetails,
                tipAmount: 1
            });

            order.payments.push(myCard);

            if (dryMode) {
                console.log("DRY MODE: The order would have been placed now.");
                return handlerInput.responseBuilder
                    .speak('This is a dry run. Your pizza order would have been placed.')
                    .getResponse();
            } else {
                await order.place();

                const tracking = new Tracking();
                const trackingResult = await tracking.byPhone(customer.phone);
                console.log("Order placed successfully. Tracking result:", trackingResult);

                return handlerInput.responseBuilder
                    .speak('Your pizza order has been placed and is on its way!')
                    .getResponse();
            }

        } catch (error) {
            console.error("Error while placing order:", error);

            if (error instanceof ReferenceError && error.message === 'No Open Stores') {
                return handlerInput.responseBuilder
                    .speak('Sorry, there are no open stores near you at the moment. Please try again later.')
                    .getResponse();
            } else {
                return handlerInput.responseBuilder
                    .speak('Sorry, there was an issue placing your order. Please try again later.')
                    .getResponse();
            }
        }
    }
};

export const handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(LaunchRequestHandler)
    .lambda();

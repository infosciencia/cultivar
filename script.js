
#include <Arduino.h>
#include <ArduinoJson.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <NTPClient.h>

#include <FirebaseClient.h>
#include <WiFiClientSecure.h>

#define WIFI_SSID "REDE_2.4"
#define WIFI_PASSWORD "KtmSC125#"

#define DATABASE_SECRET "ocSUSsb4X3bFl3vdcwQ4FHeSMa2a0ODluMJu5SQp"
#define DATABASE_URL "horta-vertical-96557-default-rtdb.firebaseio.com"

#define SENSOR_UMIDADE_PIN 34
#define BOMBA_IRRIGACAO_PIN 2
#define TEMPO_IRRIGACAO 180
#define ESPERA 3600

int sensorUmidadeValue = 0;
int statusBombaValue = 0;
int valorUmidade = 0;
int valorBomba = 0;
int valorCiclos = 0;
int valorIrrigarManual = 0;
int valorIrrigarAutomatico = 0;
int valorRangeMax = 0;
int valorRangeMin = 0;
int valorReservatorio = 1;
int valorUmidadeAtual = 0;
int valorUmidadeInicio = 0;
int umidadeInicialIrrigacao = 0;
bool status = false;

int ultimaIrrigacao = 0;
bool irrigarManualAtiva = false;
bool irrigarAutomaticaAtiva = false;

int currentTime = 0;
int horarioInicio = 6;
int horarioFinal = 24;
int horaAtual = 0;
String dataAtual = "";
String horarioAtual = "";

WiFiUDP ntpUDP;
NTPClient timeClient(ntpUDP, "pool.ntp.org", -3 * 3600, 60000);

WiFiClientSecure ssl;
DefaultNetwork network;
AsyncClientClass client(ssl, getNetwork(network));

FirebaseApp app;
RealtimeDatabase Database;
AsyncResult result;
LegacyToken dbSecret(DATABASE_SECRET);

void printError(int code, const String &msg)
{
    Firebase.printf("Error, msg: %s, code: %d\n", msg.c_str(), code);
}

void setupWiFi(){
    Serial.begin(115200);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.print("Connecting to Wi-Fi");
    while (WiFi.status() != WL_CONNECTED)
    {
        Serial.print(".");
        delay(300);
    }
    Serial.println();
    Serial.print("Connected with IP: ");
    Serial.println(WiFi.localIP());
    Serial.println();
}

void setupNTP() {
  timeClient.begin();
  timeClient.update();
}

void setupFirebase() {
    Firebase.printf("Firebase Client v%s\n", FIREBASE_CLIENT_VERSION);

    ssl.setInsecure();
    initializeApp(client, app, getAuth(dbSecret));
    app.getApp<RealtimeDatabase>(Database);
    Database.url(DATABASE_URL);
    client.setAsyncResult(result);
}

String getFormattedDate(unsigned long epochTime) {
  struct tm *ptm = gmtime((time_t *)&epochTime);

  char dateString[11];  // dd/mm/YYYY
  sprintf(dateString, "%02d/%02d/%04d", ptm->tm_mday, ptm->tm_mon + 1, ptm->tm_year + 1900);

  return String(dateString);
}

void updateTime() {
  timeClient.update();
  currentTime = timeClient.getEpochTime();
  horarioAtual = timeClient.getFormattedTime();
  dataAtual = getFormattedDate(timeClient.getEpochTime());
  horaAtual = timeClient.getHours();
}

void setup()
{
    setupWiFi();
    setupFirebase();
    setupNTP();
    pinMode(SENSOR_UMIDADE_PIN, INPUT);
    pinMode(BOMBA_IRRIGACAO_PIN, OUTPUT);
    delay(1000);
}

void lerSensorUmidade() {
  int soilMoistureValue = 500; 
  sensorUmidadeValue = map(soilMoistureValue, 0, 1023, 100, 0);
}

void acionarBomba(bool estado) {
  statusBombaValue = estado ? 1 : 0;
  if (estado) {
    digitalWrite(BOMBA_IRRIGACAO_PIN, HIGH);  // Ativa a bomba
  } else {
    valorCiclos = (valorCiclos + 1);
    ultimaIrrigacao = 0;
    digitalWrite(BOMBA_IRRIGACAO_PIN, LOW);  // Desativa a bomba
  }
  delay(100);
}

bool validaHorarioIrrigacao() {
  if (horaAtual > horarioInicio && horaAtual < horarioFinal) {
    return true;
  }
  return false;
}

bool validaTempoIrrigacao() {
  if (currentTime > (ultimaIrrigacao + TEMPO_IRRIGACAO)) {
    acionarBomba(false);
    return true;
  }
  return false;
}

bool validaTempoEspera() {
  if (currentTime > (ultimaIrrigacao + ESPERA)) {
    return true;
  }
  return false;
}

void verificarReservatorio() {
  if (irrigarAutomaticaAtiva && (currentTime - ultimaIrrigacao) > 600 && (sensorUmidadeValue <= umidadeInicialIrrigacao)) {
    valorReservatorio = 0;
  } else {
    valorReservatorio = 1;
  }
}


bool atualizaFirebase() {
  DynamicJsonDocument doc(1024);
  String jsonData;
  doc["bomba"] = statusBombaValue;
  doc["ciclos"] = valorCiclos;
  doc["irrigarAutomatico"] = valorIrrigarAutomatico;
  doc["irrigarManual"] = valorIrrigarManual;
  JsonObject range = doc.createNestedObject("range");
  range["max"] = valorRangeMax;
  range["min"] = valorRangeMin;
  doc["reservatorio"] = valorReservatorio;
  doc["umidadeAtual"] = sensorUmidadeValue;
  serializeJson(doc, jsonData);
  if (Database.set<object_t>(client, "/data", object_t(jsonData))){
    delay(100);
    return true;
  } else {
    printError(client.lastError().code(), client.lastError().message());
    delay(100);
    ESP.restart();
    return false;
  }
}

void adicionarHistorico(int inicio, int final){
  DynamicJsonDocument doc(1024);
  doc["data"] = dataAtual;
  doc["hora"] = horarioAtual;
  doc["inicio"] = inicio;
  doc["termino"] = final;
  String json;
  serializeJson(doc, json);
  String name = Database.push<object_t>(client, "/historico", object_t(json));
  if (client.lastError().code() == 0){
      Firebase.printf("ok, name: %s\n", name.c_str());
  } else {
    Serial.println("Falha ao atualizar dados");
    printError(client.lastError().code(), client.lastError().message());
  } 
}

void consultaDadosFirebase() {
  DynamicJsonDocument doc(1024);
  String dados = Database.get<String>(client, "/data");
  if (client.lastError().code() == 0){
    DeserializationError error = deserializeJson(doc, dados);
    if (error) {
      Serial.print(F("Falha ao ler o JSON: "));
      Serial.println(error.f_str());
      return;
    }
    Serial.println(dados);
    valorUmidade = doc["umidadeAtual"];
    valorBomba = doc["bomba"];
    valorCiclos = doc["ciclos"];
    valorIrrigarManual = doc["irrigarManual"];
    valorIrrigarAutomatico = doc["irrigarAutomatico"];
    valorRangeMin = doc["range"]["min"];
    valorRangeMax = doc["range"]["max"];
    delay(100);
  } else { 
    printError(client.lastError().code(), client.lastError().message());
    ESP.restart();
  }
  
}

void loop()
{
  lerSensorUmidade();
  updateTime();
  consultaDadosFirebase();

  int statusBomba = statusBombaValue;
  int irrigarManual = valorIrrigarManual;
  int irrigarAutomatico = valorIrrigarAutomatico;
  int umidadeAtual = sensorUmidadeValue;
  int rangeMin = valorRangeMin;
  int rangeMax = valorRangeMax;
  int reservatorio = valorReservatorio;
 atualizaFirebase();
  verificarReservatorio();
  if (statusBomba == 0) {
    if (validaHorarioIrrigacao()) {
      if (validaTempoEspera()) {
        if (irrigarAutomatico && !irrigarManual) {
          if (!irrigarAutomaticaAtiva && (umidadeAtual < rangeMin)) {
            irrigarAutomaticaAtiva = true;

            valorReservatorio = 1;
            valorUmidadeInicio = umidadeAtual;
            ultimaIrrigacao = currentTime;

            umidadeInicialIrrigacao = sensorUmidadeValue;
            acionarBomba(true);
            atualizaFirebase();
          } else if (irrigarAutomaticaAtiva && (umidadeAtual < rangeMax)) {

            valorReservatorio = 1;
            ultimaIrrigacao = currentTime;

            acionarBomba(true);
            atualizaFirebase();
          } else if (irrigarAutomaticaAtiva && (umidadeAtual >= rangeMax)) {

            valorReservatorio = 1;
            Serial.print(F("adicionarHistorico: 1"));
            adicionarHistorico(valorUmidadeInicio, umidadeAtual);
            irrigarAutomaticaAtiva = false;
            acionarBomba(false);
            atualizaFirebase();
          }
        }
        if (irrigarManual) {
          acionarBomba(true);
          valorUmidadeInicio = umidadeAtual;
          ultimaIrrigacao = currentTime;
          bool status = atualizaFirebase();
          if (status) {
            irrigarManualAtiva = true;
          }
        }
      }
    }
  } else {
    if (!irrigarManualAtiva) {
      bool status = validaTempoIrrigacao();
      if (status) {
        bool status = atualizaFirebase();
        if (status) {
          Serial.print(F("adicionarHistorico: 3"));
          adicionarHistorico(valorUmidadeInicio, umidadeAtual);
        }
      }
    }
    if (irrigarManualAtiva && !irrigarManual) {
      acionarBomba(false);
      bool status = atualizaFirebase();
      if (status) {
        Serial.print(F("adicionarHistorico: 2"));
        adicionarHistorico(valorUmidadeInicio, umidadeAtual);
        irrigarManualAtiva = false;
      }
    }

  }
  delay(5000);
}

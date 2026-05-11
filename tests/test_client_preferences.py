from datetime import datetime, timezone

from app.services.client_preferences import (
    client_preferences_from_db,
    client_preferences_to_json,
    normalize_client_preferences,
)


def _utc_iso_from_seconds(seconds: float) -> str:
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat().replace('+00:00', 'Z')


def test_normalize_client_preferences_base_fields():
    normalized = normalize_client_preferences(
        {
            'darkMode': True,
            'messageScale': 4.2,
            'performanceMode': ' FULL ',
            'motionLevel': 'Balanced',
            'sendShortcut': 'CTRL_ENTER',
            'timeFormat': '24H',
            'language': ' EN ',
        }
    )

    assert normalized['darkMode'] is True
    assert normalized['messageScale'] == 1.3
    assert normalized['performanceMode'] == 'full'
    assert normalized['motionLevel'] == 'balanced'
    assert normalized['sendShortcut'] == 'ctrl_enter'
    assert normalized['timeFormat'] == '24h'
    assert normalized['language'] == 'en'


def test_normalize_client_preferences_sidebar_weather_fields():
    normalized = normalize_client_preferences(
        {
            'sidebarWeatherEnabled': True,
            'sidebarWeatherSource': ' CITY ',
            'sidebarWeatherCity': '  New   York   ',
            'sidebarWeatherRotateSeconds': '60',
            'sidebarWeatherMetrics': ['temperature', ' AQI ', 'aqi', 'bad'],
        }
    )

    assert normalized['sidebarWeatherEnabled'] is True
    assert normalized['sidebarWeatherSource'] == 'city'
    assert normalized['sidebarWeatherCity'] == 'New York'
    assert normalized['sidebarWeatherRotateSeconds'] == 60
    assert normalized['sidebarWeatherMetrics'] == ['temperature', 'aqi']


def test_normalize_client_preferences_updated_at_from_epoch_and_iso():
    epoch_seconds = 1_710_000_000
    epoch_milliseconds = '1710000000000'
    iso_value = '2026-01-02T03:04:05+03:00'

    normalized_seconds = normalize_client_preferences({'updatedAt': epoch_seconds})
    normalized_milliseconds = normalize_client_preferences({'updatedAt': epoch_milliseconds})
    normalized_iso = normalize_client_preferences({'updatedAt': iso_value})
    normalized_invalid = normalize_client_preferences({'updatedAt': 42})

    assert normalized_seconds['updatedAt'] == _utc_iso_from_seconds(epoch_seconds)
    assert normalized_milliseconds['updatedAt'] == _utc_iso_from_seconds(epoch_seconds)
    assert normalized_iso['updatedAt'] == '2026-01-02T00:04:05Z'
    assert 'updatedAt' not in normalized_invalid


def test_client_preferences_json_round_trip():
    source = {
        'darkMode': False,
        'messageScale': 1.1,
        'language': 'ru',
        'sidebarWeatherRotateSeconds': 30,
    }
    packed = client_preferences_to_json(source)
    restored = client_preferences_from_db(packed)

    assert restored == normalize_client_preferences(source)
